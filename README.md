# SOV CRM (mini CRM)

## Rodar com backend (recomendado)

1. Instale dependências: `npm install`
2. Inicie o servidor: `npm start`
3. Abra no navegador: `http://localhost:3000`

O servidor:
- Serve os arquivos `login.html`, `index.html`, `style.css`, `script.js` e `imagens/`
- Por padrão salva em `data/db.json` (ignorado no git via `.gitignore`)
- Se `DATABASE_URL` estiver definido, usa Postgres (recomendado em produção, ex.: Railway)
- Autentica via JWT (8h)
- Sincroniza leads entre usuários e grava auditoria (`/api/audit`)
- Recebe formulário do site sem expor token em `POST /api/public/site-form-submit` e cria lead na etapa `Leads do site`
- No modal **Dados**, permite importar/exportar **JSON** e **Excel (.xlsx)**
- Consultor vê apenas leads do próprio usuário; admin pode reatribuir o consultor ao editar o lead

### Usuários padrão (seed)

Em dev (ou se `SOV_ALLOW_DEFAULT_SEED=1`), na primeira execução ele cria usuários:
- `admin` / `admin123`
- `grazielle` / `grazielle123`
- `pedro` / `pedro123`
- `poli` / `poli123`
- `gustavo` / `gustavo123`
- `victor` / `victor123`
- `marcelo` / `marcelo123`

Em produção, prefira definir `SOV_BOOTSTRAP_ADMIN_PASS` para criar um admin inicial.
Se não definir, o servidor cria um admin com senha temporária e imprime no log (`[BOOTSTRAP] ...`).

## Rodar offline (sem servidor)

Você ainda pode abrir `login.html` direto e usar `localStorage`, mas:
- não tem sincronização/multiusuário
- não tem auditoria no servidor

## Captura de Leads do Site

Rota recomendada para frontend (sem token no browser):

- `POST /api/public/site-form-submit`

Rota para integração servidor-servidor (com token):

- `POST /api/public/site-leads`

Campos aceitos no JSON:

- `name` (ou `nome`) - obrigatório
- `phone` (ou `telefone`/`celular`) - recomendado
- `email` - recomendado
- `origin` (ou `origem`) - opcional
- `value` (ou `valor`) - opcional
- `nextStep` (ou `proximoPasso`) - opcional
- `message` (ou `mensagem`) - opcional
- `tags` (array ou string separada por vírgula) - opcional
- quaisquer outros campos simples são guardados em `obs` automaticamente

Resposta:
- `201` com `{ ok: true }` em `/api/public/site-form-submit`
- `201` com `{ ok: true, lead: ... }` em `/api/public/site-leads`
- `400` se faltar `name` ou faltar contato (`phone` e `email`)
- `403` se `SOV_SITE_FORM_TOKEN` estiver ativo e o token estiver inválido
- `403` se origem não permitida em `/api/public/site-form-submit`
- `429` se exceder limite de envios por IP em `/api/public/site-form-submit`

Exemplo para frontend (sem token exposto):

```js
await fetch('https://SEU-DOMINIO/api/public/site-form-submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Maria Silva',
    phone: '(11) 99999-0000',
    email: 'maria@email.com',
    origin: 'Site Racon',
    message: 'Quero simulação para carta de 300 mil.',
    company_website: '' // honeypot (deixe vazio)
  })
});
```

Exemplo servidor-servidor (com token):

```js
await fetch('https://SEU-DOMINIO/api/public/site-leads', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Site-Form-Token': 'SEU_TOKEN_OPCIONAL'
  },
  body: JSON.stringify({
    name: 'Maria Silva',
    phone: '(11) 99999-0000',
    email: 'maria@email.com',
    origin: 'Site Racon',
    message: 'Quero simulação para carta de 300 mil.'
  })
});
```

## Variáveis de ambiente

- `PORT` (default `3000`)
- `SOV_JWT_SECRET` (recomendado em produção; mínimo 16 chars)
- `DATABASE_URL` (Postgres; quando definido, ativa o modo Postgres)
- `PGSSL` (`1`/`0`; default: `1` em `NODE_ENV=production`)
- `SOV_ALLOW_DEFAULT_SEED` (`1` para permitir usuários padrão em produção)
- `SOV_BOOTSTRAP_ADMIN_USER` (default: `admin`)
- `SOV_BOOTSTRAP_ADMIN_PASS` (senha do admin inicial; recomendado no Railway)
- `SOV_SITE_LEADS_OWNER` (usuário dono dos leads vindos do site; se vazio usa o admin)
- `SOV_SITE_LEADS_ORIGIN` (origem padrão desses leads; default: `Site Racon Consorcios`)
- `SOV_SITE_FORM_TOKEN` (token opcional validado em `X-Site-Form-Token`)
- `SOV_SITE_FORM_ALLOWED_ORIGINS` (origens CORS separadas por vírgula; default: `*`)
- `SOV_SITE_FORM_RATE_LIMIT_MAX` (máximo de envios por IP na janela; default: `8`)
- `SOV_SITE_FORM_RATE_LIMIT_WINDOW_MS` (janela de rate limit em ms; default: `900000`)
- `SOV_SITE_FORM_HONEYPOT_FIELD` (nome do campo honeypot; default: `company_website`)

## Criar consultores (produção)

Depois de logar como admin, no modal **Dados (JSON)** aparece a seção **Usuários** (somente admin) para:
- criar consultores/leitura/admin
- remover usuários (ex.: quando alguém sai da equipe)
