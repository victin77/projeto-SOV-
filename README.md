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

## Variáveis de ambiente

- `PORT` (default `3000`)
- `SOV_JWT_SECRET` (recomendado em produção; mínimo 16 chars)
- `DATABASE_URL` (Postgres; quando definido, ativa o modo Postgres)
- `PGSSL` (`1`/`0`; default: `1` em `NODE_ENV=production`)
- `SOV_ALLOW_DEFAULT_SEED` (`1` para permitir usuários padrão em produção)
- `SOV_BOOTSTRAP_ADMIN_USER` (default: `admin`)
- `SOV_BOOTSTRAP_ADMIN_PASS` (senha do admin inicial; recomendado no Railway)

## Criar consultores (produção)

Depois de logar como admin, no modal **Dados (JSON)** aparece a seção **Usuários** (somente admin) para:
- criar consultores/leitura/admin
- remover usuários (ex.: quando alguém sai da equipe)
