# Sistema de Gestão de Filas - USF Chico Mendes

Sistema web para gerenciamento de filas de atendimento em unidades de saúde.

## 🚀 Instalação e Uso

### Opção 1: Com Banco de Dados (Recomendado)

1. **Instalar dependências:**
```bash
npm install
```

2. **Iniciar o servidor:**
```bash
npm start
```

3. **Acessar o sistema:**
Abra http://localhost:3000 no seu navegador

### Opção 2: Versão Frontend Apenas

Para usar apenas o frontend sem backend:

1. Renomeie `index.html.original` para `index.html`
2. Abra diretamente no navegador

## 📊 Recursos

- ✅ Cadastro de pacientes por setor
- ✅ Chamada de pacientes com anúncio em voz
- ✅ Painel público de chamadas
- ✅ Histórico de chamadas
- ✅ Banco de dados SQLite para persistência
- ✅ API RESTful

## 🔧 Desenvolvimento

Para modo de desenvolvimento com auto-reload:

```bash
npm run dev
```

## 🌐 Publicação no GitHub Pages + Vercel

### Passo 1: Enviar para o GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/fila-usf-chico-mendes.git
git push -u origin main
```

### Passo 2: Deploy na Vercel

1. Acesse https://vercel.com
2. Faça login com GitHub
3. Clique em "New Project"
4. Importe este repositório
5. Clique em "Deploy"

### Passo 3: Configurar Banco de Dados (Produção)

Para produção, use um banco PostgreSQL ou MySQL:

1. Crie um banco de dados gratuito no [Railway](https://railway.app) ou [Neon](https://neon.tech)
2. Atualize a conexão no `server.js`

## 📁 Estrutura do Projeto

```
fila/
├── server.js           # Backend Node.js + Express
├── package.json        # Dependências
├── public/
│   ├── index.html     # Frontend
│   └── app.js         # Lógica frontend
└── fila.db            # Banco SQLite (gerado automaticamente)
```

## 🛠️ Tecnologias

- **Frontend:** HTML5, CSS3, JavaScript ES6+
- **Backend:** Node.js, Express
- **Banco de Dados:** SQLite (better-sqlite3)
- **Voz:** Web Speech API

## 📝 Licença

MIT License
