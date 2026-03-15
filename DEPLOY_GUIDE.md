# 🚀 GUIA DE PUBLICAÇÃO - GitHub + Vercel

## Passo a Passo Completo

### ✅ PRÉ-REQUISITOS

1. **Ter Git instalado**
   - Baixe em: https://git-scm.com/downloads
   - Após instalar, abra o terminal e digite: `git --version`

2. **Ter Node.js instalado**
   - Baixe em: https://nodejs.org/ (versão LTS)
   - Após instalar: `node --version`

3. **Criar conta no GitHub**
   - Acesse: https://github.com/signup

---

### 📦 PASSO 1: Preparar o Projeto

Abra o terminal na pasta do projeto (`c:\Users\ednac\FILA`) e execute:

```bash
# Instalar dependências
npm install
```

---

### 🔗 PASSO 2: Enviar para o GitHub

#### 2.1 Inicializar repositório Git
```bash
git init
```

#### 2.2 Adicionar todos os arquivos
```bash
git add .
```

#### 2.3 Fazer o primeiro commit
```bash
git commit -m "Primeiro commit - Sistema de Filas USF Chico Mendes"
```

#### 2.4 Renomear branch para main
```bash
git branch -M main
```

#### 2.5 Criar repositório no GitHub

1. Acesse https://github.com/new
2. Preencha:
   - **Repository name:** `fila-usf-chico-mendes`
   - **Description:** "Sistema de Gestão de Filas - USF Chico Mendes"
   - **Public:** ✅ (marcado)
   - **Initialize with README:** ❌ (desmarcado)
3. Clique em **"Create repository"**

#### 2.6 Conectar e enviar

Copie o comando que aparece no GitHub (será algo como):
```bash
git remote add origin https://github.com/SEU_USUARIO/fila-usf-chico-mendes.git
```

Substitua `SEU_USUARIO` pelo seu usuário do GitHub e execute:
```bash
git remote add origin https://github.com/SEU_USUARIO/fila-usf-chico-mendes.git
git push -u origin main
```

✅ **Pronto!** Seu código está no GitHub!

---

### 🌐 PASSO 3: Publicar na Vercel (Grátis)

#### 3.1 Acessar Vercel
1. Acesse: https://vercel.com
2. Clique em **"Sign Up"**
3. Faça login com sua conta do GitHub

#### 3.2 Criar novo projeto
1. Clique em **"Add New Project"**
2. Em **"Import Git Repository"**, clique em **"Adjust GitHub App Permissions"** se necessário
3. Encontre e selecione `fila-usf-chico-mendes`
4. Clique em **"Import"**

#### 3.3 Configurar deploy
1. **Framework Preset:** Deixe em branco ou selecione "Other"
2. **Root Directory:** Deixe como está
3. **Build Command:** `npm run build`
4. **Output Directory:** deixe em branco
5. **Install Command:** `npm install`

#### 3.4 Fazer deploy
Clique em **"Deploy"**

⏳ Aguarde alguns minutos...

✅ **Seu projeto está online!**

A Vercel vai gerar uma URL como:
`https://fila-usf-chico-mendes.vercel.app`

---

### 🎯 PASSO 4: Configurar Domínio Personalizado (Opcional)

Se quiser um domínio próprio:

1. Na Vercel, vá em **Settings > Domains**
2. Adicione seu domínio (ex: `filausf.com.br`)
3. Siga as instruções para configurar DNS

---

### 💾 BANCO DE DADOS NA NUVEM

Para produção, use um banco PostgreSQL gratuito:

#### Opção 1: Neon (Recomendado)
1. Acesse https://neon.tech
2. Crie conta gratuita
3. Crie um novo projeto
4. Copie a **Connection String**
5. No `server.js`, substitua SQLite por PostgreSQL

#### Opção 2: Railway
1. Acesse https://railway.app
2. Crie conta
3. Adicione um banco PostgreSQL
4. Copie as credenciais

---

### 🔄 ATUALIZAR O PROJETO

Sempre que fizer alterações:

```bash
# No seu computador
git add .
git commit -m "Descrição das mudanças"
git push
```

A Vercel atualiza automaticamente!

---

### 📊 ACESSAR O SISTEMA

Após o deploy, o sistema estará disponível em:
- **URL:** `https://fila-usf-chico-mendes.vercel.app`
- **Acesso:** Gratuito e público

---

### ⚠️ IMPORTANTE

1. **SQLite na Vercel:** O SQLite funciona localmente, mas em produção os dados são temporários
2. **Solução:** Use Neon ou Railway para banco de dados permanente
3. **Variáveis de ambiente:** Configure na Vercel em **Settings > Environment Variables**

---

### 🆘 SUPORTE

- Documentação Vercel: https://vercel.com/docs
- Documentação GitHub: https://docs.github.com
- Comunidade: Stack Overflow

---

### ✅ CHECKLIST FINAL

- [ ] Git instalado
- [ ] Node.js instalado
- [ ] Conta no GitHub criada
- [ ] Repositório criado no GitHub
- [ ] Código enviado (push)
- [ ] Conta na Vercel criada
- [ ] Projeto implantado na Vercel
- [ ] URL de produção testada

🎉 **Parabéns! Seu sistema está publicado!**
