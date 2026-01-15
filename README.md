# SOV — Sistema Operacional da Venda (MVP)

Stack: HTML/CSS/JS + Node/Express + SQLite

## Rodar local
```bash
npm install
npm run seed
npm run dev
```
Abra: http://localhost:3333

Logins (seed):
- admin@sov.local / admin123
- gestor@sov.local / gestor123
- c1@sov.local / consultor123
- c2@sov.local / consultor123

## Railway (hospedar)
- Suba este projeto como um repositório (ou upload).
- Railway detecta Node automaticamente.
- Comando de start: `npm start`

**IMPORTANTE:** SQLite em Railway é **efêmero** se você não usar Volume.
Se quiser manter dados:
- Ative um **Volume** no Railway e monte em `/app/db` (ou equivalente)
- Ou troque o banco para Postgres futuramente.

## Recursos incluídos (os 5 pedidos)
1) Tela de detalhe do lead (`/lead.html?id=...`) com edição, tarefas e interações
2) Mover para "Perdido" abre modal com motivo obrigatório (Kanban e detalhe)
3) Gestor/admin: filtro por consultor + Kanban filtrado + reatribuição no detalhe do lead
4) Backup: botão "Baixar backup (SQLite)" no painel do gestor
5) Importar CSV: botão no painel do gestor (envia e cria leads)

### Formato do CSV (header recomendado)
```csv
name,phone,origin,type,value_estimated,stage,next_followup_at,next_step,owner_email,owner_user_id
Maria,65999999999,Instagram,auto,85000,Novo lead,2026-01-20 10:00,Enviar simulação,c1@sov.local,
```
- `next_followup_at` aceita ISO, ou `dd/mm/yyyy` ou `dd/mm/yyyy hh:mm`
- Se não informar owner, usa o filtro selecionado (ou o usuário logado)
