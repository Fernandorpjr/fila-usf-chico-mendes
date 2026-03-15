# ⚡ INÍCIO RÁPIDO - Como Usar o Sistema

## 🎯 Opção 1: Testar Localmente (Sem Banco de Dados)

### Apenas abrir no navegador:
1. Vá até a pasta `c:\Users\ednac\FILA`
2. Abra o arquivo `index.html.html` diretamente no Chrome, Firefox ou Edge
3. Pronto! O sistema funciona sem backend também!

---

## 🚀 Opção 2: Com Banco de Dados (Recomendado)

### Passo 1: Instalar Node.js
- Baixe em: https://nodejs.org/
- Instale a versão **LTS**
- Após instalar, feche e abra o terminal

### Passo 2: Instalar dependências
No terminal, na pasta do projeto:
```bash
npm install
```

### Passo 3: Iniciar servidor
```bash
npm start
```

### Passo 4: Acessar
Abra no navegador: **http://localhost:3000**

✅ O sistema está rodando com banco de dados SQLite!

---

## 📋 COMANDOS ÚTEIS

### Iniciar o sistema:
```bash
npm start
```

### Modo desenvolvimento (auto-reload):
```bash
npm run dev
```

### Parar o servidor:
Pressione `Ctrl + C` no terminal

---

## 🔧 ESTRUTURA DE ARQUIVOS

```
FILA/
├── server.js           → Backend com API
├── package.json        → Configuração do projeto
├── public/
│   ├── index.html     → Frontend (tela principal)
│   └── app.js         → Lógica frontend + API
├── fila.db            → Banco de dados (criado automaticamente)
├── README.md          → Documentação completa
└── DEPLOY_GUIDE.md    → Guia de publicação GitHub/Vercel
```

---

## 💡 FUNCIONALIDADES

### ✅ Recepção
- Cadastrar pacientes por setor (Farmácia, Regulação, Consulta)
- Visualizar total de pacientes por setor
- Ver últimos cadastrados

### ✅ Setores (Farmácia/Regulação/Consulta)
- Chamar próximo paciente da fila
- Anúncio em voz alta (texto para fala)
- Repetir chamada
- Visualizar fila de espera

### ✅ Painel Público
- Mostra última chamada em destaque
- Histórico das últimas 10 chamadas
- Design responsivo para TV/monitor

---

## 🎨 PERSONALIZAÇÃO

### Cores do tema:
Edite as variáveis CSS no início do arquivo `public/index.html`:

```css
:root {
  --blue: #1a4fc4;      /* Cor principal */
  --green: #4aab3c;     /* Farmácia */
  --orange: #f4821e;    /* Consulta */
}
```

### Nome da unidade:
Procure por "USF Chico Mendes" no HTML e substitua pelo nome desejado.

---

## ❓ PROBLEMAS COMUNS

### "npm não é reconhecido"
→ Instale o Node.js e reinicie o terminal

### "Porta 3000 já está em uso"
→ Mude a porta no `server.js`: `const PORT = process.env.PORT || 3001;`

### "Banco de dados não cria"
→ Execute como administrador ou verifique permissões da pasta

### "Voz não funciona"
→ Clique no botão "Ativar Som" que aparece na tela inicial

---

## 🌐 PUBLICAR ONLINE

Siga o guia completo em **DEPLOY_GUIDE.md** para publicar no GitHub + Vercel gratuitamente.

Resumo rápido:
```bash
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/fila-usf-chico-mendes.git
git push -u origin main
```

Depois implante na Vercel: https://vercel.com

---

## 📞 SUPORTE

- **Documentação:** Leia o README.md
- **Deploy:** Leia o DEPLOY_GUIDE.md
- **Dúvidas:** Consulte a comunidade no Stack Overflow

---

## ✅ CHECKLIST DIÁRIO

Antes de usar:
- [ ] Servidor rodando (`npm start`)
- [ ] Navegador aberto em http://localhost:3000
- [ ] Som ativado (clicar no modal inicial)

Ao finalizar:
- [ ] Fechar navegador
- [ ] Parar servidor (Ctrl+C)

---

🎉 **Pronto! Seu sistema de filas está configurado!**
