// @ts-nocheck
const { limparPreviasExpiradas } = require('./receitas');

let lastLazyCleanupTime = 0;
const LAZY_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // a cada 10 min no máximo

// Executa arquivamento preguiçoso e limpeza definitiva
async function executarLimpezaEArquivamento(pool, forcar = false) {
  const now = Date.now();
  if (!forcar && (now - lastLazyCleanupTime < LAZY_CLEANUP_INTERVAL_MS)) {
    return;
  }
  lastLazyCleanupTime = now;

  try {
    // 1. Obter dias de retenção
    const confRes = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'historico_retencao_dias'");
    const retencaoDias = parseInt(confRes.rows[0]?.valor || '30', 10) || 30;

    // 2. Arquivar no fuso America/Recife: consultas cuja data (nova ou anterior) já passou
    await pool.query(`
      UPDATE agendamento_historico
      SET arquivado = true, arquivado_em = CURRENT_TIMESTAMP
      WHERE (arquivado = false OR arquivado IS NULL)
        AND COALESCE(nova_data, data_anterior) < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Recife')::date
    `);

    // Arquivar agendamentos com status cancelado cuja data já passou
    await pool.query(`
      UPDATE agendamentos
      SET arquivado = true
      WHERE (arquivado = false OR arquivado IS NULL)
        AND status = 'cancelado'
        AND data_agendamento < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Recife')::date
    `);

    // 3. Exclusão definitiva de registros arquivados há mais de N dias
    await pool.query(`
      DELETE FROM agendamento_historico
      WHERE arquivado = true
        AND arquivado_em < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
    `, [retencaoDias]);

    await pool.query(`
      DELETE FROM agendamentos
      WHERE arquivado = true
        AND status = 'cancelado'
        AND COALESCE(cancelado_em, created_at) < (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
    `, [retencaoDias]);

    // 4. LGPD: Excluir acessos/logs de IP e User-Agent com mais de 90 dias
    await pool.query(`
      DELETE FROM dispositivo_acessos
      WHERE criado_em < (CURRENT_TIMESTAMP - INTERVAL '90 days')
    `);

    // Anonimizar dispositivos inativos há mais de 90 dias
    await pool.query(`
      UPDATE dispositivos
      SET ultimo_ip = NULL, user_agent = NULL
      WHERE ultimo_acesso < (CURRENT_TIMESTAMP - INTERVAL '90 days')
    `);

    // 5. LGPD: Remover automaticamente fotos/PDFs e dados de prévias após 24 horas
    try {
      const removidasPrevias = await limparPreviasExpiradas(pool, 24);
      if (removidasPrevias > 0) {
        console.log(`[LGPD 24h] ${removidasPrevias} prévia(s) de receita/SISREG removida(s) após 24h.`);
      }
    } catch (ePrev) {
      console.warn('[LGPD 24h] Erro na limpeza de receitas_previas:', ePrev.message);
    }

    // 6. LGPD: Higienizar campos clínicos/documentos em call_history após 7 dias (preserva métricas agregadas)
    await pool.query(`
      UPDATE call_history
      SET cpf = NULL,
          cartao_sus = NULL,
          queixa = NULL,
          motivo_primeira_escuta = NULL,
          observacao_segunda_escuta = NULL
      WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '7 days')
        AND (
          cpf IS NOT NULL OR
          cartao_sus IS NOT NULL OR
          queixa IS NOT NULL OR
          motivo_primeira_escuta IS NOT NULL OR
          observacao_segunda_escuta IS NOT NULL
        )
    `);

    await pool.query(`
      DELETE FROM pending_voice_calls
      WHERE processed = true AND created_at < (CURRENT_TIMESTAMP - INTERVAL '1 day')
    `).catch(() => {});

    await pool.query(`
      DELETE FROM notificacoes
      WHERE (dismissed = true AND created_at < (CURRENT_TIMESTAMP - INTERVAL '1 day'))
         OR created_at < (CURRENT_TIMESTAMP - INTERVAL '7 days')
    `).catch(() => {});

  } catch (err) {
    console.error('Erro na limpeza/arquivamento de histórico:', err.message);
  }
}

function setupHistorico(app, pool, isValidAdminPass) {

  function montarFiltrosHistoricoQuery(q = {}) {
    const {
      periodo_inicio,
      periodo_fim,
      tipo,
      profissional,
      equipe,
      tipo_atendimento,
      motivo,
      dispositivo,
      busca,
      arquivado
    } = q || {};

    let whereSql = ' WHERE 1=1';
    const params = [];
    let idx = 1;

    if (arquivado === 'true') {
      whereSql += ` AND h.arquivado = true`;
    } else if (arquivado === 'todos') {
      // não filtra
    } else {
      whereSql += ` AND (h.arquivado = false OR h.arquivado IS NULL)`;
    }

    if (periodo_inicio) {
      whereSql += ` AND COALESCE(h.nova_data, h.data_anterior) >= $${idx}::date`;
      params.push(periodo_inicio);
      idx++;
    }
    if (periodo_fim) {
      whereSql += ` AND COALESCE(h.nova_data, h.data_anterior) <= $${idx}::date`;
      params.push(periodo_fim);
      idx++;
    }
    if (tipo) {
      whereSql += ` AND h.novo_status = $${idx}`;
      params.push(tipo);
      idx++;
    }
    if (profissional) {
      whereSql += ` AND h.profissional = $${idx}`;
      params.push(profissional);
      idx++;
    }
    if (equipe) {
      if (equipe === 'Sem equipe') {
        whereSql += ` AND (a.equipe IS NULL OR a.equipe = '' OR a.equipe = 'Sem equipe')`;
      } else {
        whereSql += ` AND a.equipe = $${idx}`;
        params.push(equipe);
        idx++;
      }
    }
    if (tipo_atendimento) {
      whereSql += ` AND h.tipo_atendimento = $${idx}`;
      params.push(tipo_atendimento);
      idx++;
    }
    if (motivo) {
      whereSql += ` AND h.motivo ILIKE $${idx}`;
      params.push(`%${motivo}%`);
      idx++;
    }
    if (dispositivo) {
      whereSql += ` AND (d.nome ILIKE $${idx} OR h.usuario ILIKE $${idx})`;
      params.push(`%${dispositivo}%`);
      idx++;
    }
    if (busca) {
      whereSql += ` AND (h.paciente ILIKE $${idx} OR h.telefone ILIKE $${idx})`;
      params.push(`%${busca}%`);
      idx++;
    }
    return { whereSql, params };
  }

  // GET /api/agendamentos/historico (Lista completa com filtros combináveis)
  app.get('/api/agendamentos/historico', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    // Executa arquivamento preguiçoso
    executarLimpezaEArquivamento(pool).catch(() => {});

    try {
      const { whereSql, params } = montarFiltrosHistoricoQuery(req.query);
      const query = `
        SELECT 
          h.id,
          h.agendamento_id,
          h.paciente,
          h.telefone,
          h.tipo_atendimento,
          h.profissional,
          h.status_anterior,
          h.novo_status,
          h.motivo,
          h.data_anterior,
          h.horario_anterior,
          h.nova_data,
          h.novo_horario,
          h.em_lote,
          h.criado_em,
          h.dispositivo_id,
          h.usuario,
          h.arquivado,
          h.arquivado_em,
          h.vaga_reaproveitada,
          COALESCE(d.nome, 'Sem nome') as dispositivo_nome,
          COALESCE(a.equipe, 'Sem equipe') as equipe
        FROM agendamento_historico h
        LEFT JOIN dispositivos d ON h.dispositivo_id = d.id
        LEFT JOIN agendamentos a ON h.agendamento_id = a.id
        ${whereSql}
        ORDER BY COALESCE(h.nova_data, h.data_anterior) ASC, h.criado_em DESC`;

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error('Erro ao listar histórico com filtros:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agendamentos/historico/resumo (Dados agregados para cards e gráficos)
  app.get('/api/agendamentos/historico/resumo', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const { periodo_inicio, periodo_fim } = req.query;
      let dateFilter = '';
      const params = [];
      let idx = 1;

      if (periodo_inicio) {
        dateFilter += ` AND COALESCE(h.nova_data, h.data_anterior) >= $${idx}::date`;
        params.push(periodo_inicio);
        idx++;
      }
      if (periodo_fim) {
        dateFilter += ` AND COALESCE(h.nova_data, h.data_anterior) <= $${idx}::date`;
        params.push(periodo_fim);
        idx++;
      }

      // Totais gerais
      const totaisRes = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE h.novo_status = 'cancelado') as total_cancelados,
          COUNT(*) FILTER (WHERE h.novo_status = 'reagendado') as total_reagendados,
          COUNT(*) FILTER (WHERE h.vaga_reaproveitada = true) as total_vagas_reaproveitadas,
          COUNT(*) FILTER (WHERE h.novo_status = 'cancelado' AND h.vaga_reaproveitada = false) as cancelados_sem_nova_data
        FROM agendamento_historico h
        WHERE 1=1 ${dateFilter}
      `, params);

      // Por dia da consulta
      const porDiaRes = await pool.query(`
        SELECT 
          COALESCE(h.nova_data, h.data_anterior) as dia,
          COUNT(*) FILTER (WHERE h.novo_status = 'cancelado') as cancelados,
          COUNT(*) FILTER (WHERE h.novo_status = 'reagendado') as reagendados
        FROM agendamento_historico h
        WHERE 1=1 ${dateFilter}
        GROUP BY COALESCE(h.nova_data, h.data_anterior)
        ORDER BY dia ASC
        LIMIT 30
      `, params);

      // Por profissional
      const porProfRes = await pool.query(`
        SELECT 
          COALESCE(NULLIF(TRIM(h.profissional), ''), 'Não informado') as profissional,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE h.novo_status = 'cancelado') as cancelados,
          COUNT(*) FILTER (WHERE h.novo_status = 'reagendado') as reagendados
        FROM agendamento_historico h
        WHERE 1=1 ${dateFilter}
        GROUP BY COALESCE(NULLIF(TRIM(h.profissional), ''), 'Não informado')
        ORDER BY total DESC
        LIMIT 10
      `, params);

      // Por motivo
      const porMotivoRes = await pool.query(`
        SELECT 
          COALESCE(NULLIF(TRIM(h.motivo), ''), 'Sem motivo informado') as motivo,
          COUNT(*) as total
        FROM agendamento_historico h
        WHERE 1=1 ${dateFilter}
        GROUP BY COALESCE(NULLIF(TRIM(h.motivo), ''), 'Sem motivo informado')
        ORDER BY total DESC
        LIMIT 10
      `, params);

      res.json({
        totais: totaisRes.rows[0],
        porDia: porDiaRes.rows,
        porProfissional: porProfRes.rows,
        porMotivo: porMotivoRes.rows
      });
    } catch (err) {
      console.error('Erro ao gerar resumo de histórico:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/agendamentos/historico/csv (Exportar histórico para CSV respeitando filtros)
  app.get('/api/agendamentos/historico/csv', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const { whereSql, params } = montarFiltrosHistoricoQuery(req.query);
      const result = await pool.query(`
        SELECT 
          h.id,
          h.paciente,
          h.telefone,
          h.tipo_atendimento,
          h.profissional,
          COALESCE(a.equipe, 'Sem equipe') as equipe,
          h.novo_status,
          h.motivo,
          h.data_anterior,
          h.horario_anterior,
          h.nova_data,
          h.novo_horario,
          COALESCE(d.nome, 'Sem nome') as dispositivo,
          h.usuario,
          h.vaga_reaproveitada,
          h.arquivado,
          h.criado_em
        FROM agendamento_historico h
        LEFT JOIN dispositivos d ON h.dispositivo_id = d.id
        LEFT JOIN agendamentos a ON h.agendamento_id = a.id
        ${whereSql}
        ORDER BY COALESCE(h.nova_data, h.data_anterior) ASC, h.criado_em DESC
      `, params);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="historico_cancelamentos_reagendamentos.csv"');

      // BOM para Excel reconhecer acentuação UTF-8
      res.write('\uFEFF');

      // Cabeçalho
      res.write('ID;Paciente;Telefone;Tipo de Atendimento;Profissional;Equipe;Status;Motivo;Data Original;Horário Original;Nova Data;Novo Horário;Dispositivo;Usuário;Vaga Reaproveitada;Arquivado;Registrado Em\r\n');

      for (const r of result.rows) {
        const escapeCsv = (val) => {
          if (val === null || val === undefined) return '';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        };

        const dtAnt = r.data_anterior ? new Date(r.data_anterior).toISOString().split('T')[0] : '';
        const dtNov = r.nova_data ? new Date(r.nova_data).toISOString().split('T')[0] : '';
        const dtCriado = r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '';

        const linha = [
          r.id,
          escapeCsv(r.paciente),
          escapeCsv(r.telefone),
          escapeCsv(r.tipo_atendimento),
          escapeCsv(r.profissional),
          escapeCsv(r.equipe),
          r.novo_status,
          escapeCsv(r.motivo),
          dtAnt,
          r.horario_anterior || '',
          dtNov,
          r.novo_horario || '',
          escapeCsv(r.dispositivo),
          escapeCsv(r.usuario),
          r.vaga_reaproveitada ? 'Sim' : 'Não',
          r.arquivado ? 'Sim' : 'Não',
          escapeCsv(dtCriado)
        ].join(';');

        res.write(linha + '\r\n');
      }

      res.end();
    } catch (err) {
      console.error('Erro ao exportar CSV:', err.message);
      res.status(500).send('Erro ao exportar CSV');
    }
  });

  // PATCH /api/agendamentos/historico/:id/vaga (Marcar se a vaga foi reaproveitada)
  app.patch('/api/agendamentos/historico/:id/vaga', async (req, res) => {
    const { id } = req.params;
    const { vaga_reaproveitada } = req.body || {};
    try {
      const q = await pool.query(
        `UPDATE agendamento_historico 
         SET vaga_reaproveitada = $2 
         WHERE id = $1 
         RETURNING *`,
        [id, !!vaga_reaproveitada]
      );
      if (q.rows.length === 0) {
        return res.status(404).json({ error: 'Registro não encontrado' });
      }
      res.json({ ok: true, registro: q.rows[0] });
    } catch (err) {
      console.error('Erro ao alternar status de reaproveitamento de vaga:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agendamentos/historico/excluir (Exclusão manual unitária ou em lote com senha admin)
  app.post('/api/agendamentos/historico/excluir', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { senha: bodySenha, ids } = req.body || {};
    const senha = bodySenha || req.headers['x-admin-password'] || req.headers['x-admin-pass'];

    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Nenhum registro selecionado para exclusão' });
    }

    try {
      const q = await pool.query(
        `DELETE FROM agendamento_historico WHERE id = ANY($1) RETURNING id`,
        [ids]
      );
      res.json({ ok: true, deletados: q.rows.length });
    } catch (err) {
      console.error('Erro ao excluir registros de histórico:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/config/retencao (Ler prazo de retenção)
  app.get('/api/admin/config/retencao', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const q = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'historico_retencao_dias'");
      const dias = parseInt(q.rows[0]?.valor || '30', 10) || 30;
      res.json({ retencao_dias: dias });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/config/retencao (Configurar prazo N dias)
  app.put('/api/admin/config/retencao', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { senha: bodySenha, retencao_dias } = req.body || {};
    const senha = bodySenha || req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    const hasAdminSess = Boolean(req.session && req.session.role === 'admin');
    if (!hasAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    const dias = parseInt(retencao_dias, 10);
    if (isNaN(dias) || dias < 1 || dias > 365) {
      return res.status(400).json({ error: 'Prazo de retenção deve ser entre 1 e 365 dias' });
    }

    try {
      await pool.query(
        `INSERT INTO configuracoes (chave, valor) VALUES ('historico_retencao_dias', $1)
         ON CONFLICT (chave) DO UPDATE SET valor = $1`,
        [String(dias)]
      );
      res.json({ ok: true, retencao_dias: dias });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/cron/limpeza (Cron diário da Vercel)
  app.get('/api/cron/limpeza', async (req, res) => {
    // Vercel cron envia cabeçalho Authorization: Bearer <CRON_SECRET>
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'];
    const adminHeader = req.headers['x-admin-password'];
    const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
    const authorizedCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
    const authorizedAdmin = typeof isValidAdminPass === 'function' && isValidAdminPass(adminHeader);
    const authorizedDevNoSecret = !isProd && !cronSecret;

    if (!authorizedCron && !authorizedAdmin && !authorizedDevNoSecret) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
      await executarLimpezaEArquivamento(pool, true);
      res.json({ ok: true, msg: 'Limpeza e arquivamento executados com sucesso' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  setupHistorico,
  executarLimpezaEArquivamento
};
