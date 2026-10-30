# Auditoria encadeada

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende à seção de auditoria de [03-arquitetura.md](../planejamento/03-arquitetura.md) e à Etapa 7 do plano.

## O que já existia

A trilha (`audit.events`) registra toda decisão de acesso, permitida ou negada, e toda busca por identificador fora do alcance do usuário ([organizacao-e-permissoes.md](organizacao-e-permissoes.md)). Um gatilho no banco recusa `UPDATE` e `DELETE`.

## Encadeamento por hash

Cada organização tem a sua cadeia. Ao gravar um evento, o **próprio banco** (gatilho `audit.chain_event`):

1. trava a cadeia da organização, para que dois eventos simultâneos não peguem o mesmo elo anterior;
2. dá ao evento a próxima posição da cadeia (`chain_seq`: 1, 2, 3...);
3. copia o resumo do evento anterior (`prev_hash`; vazio no primeiro);
4. calcula o resumo do evento (`hash`): SHA-256 de todos os campos do evento, da posição e do resumo anterior.

Como cada resumo depende do anterior, alterar, apagar ou inserir um evento no meio quebra a cadeia daquele ponto em diante. Eventos sem organização (por exemplo, login com e-mail desconhecido) formam uma cadeia própria.

O cálculo fica no banco para valer em qualquer caminho de gravação, e a mesma função (`audit.event_digest`) é usada para gravar e para verificar.

## Verificação

`GET /audit/verify` (administrador) percorre a cadeia da organização e confere, evento por evento:

- a posição é a seguinte da anterior (detecta evento apagado);
- o `prev_hash` é o resumo do evento anterior (detecta evento inserido ou trocado);
- o `hash` confere com o conteúdo (detecta campo alterado).

Resposta: `{ valid, checked, headHash, headSeq, problems: [{ chainSeq, eventId, issue }] }`, com até 20 problemas. `issue` é `gap` (posição faltando), `link` (elo anterior não confere) ou `content` (conteúdo alterado). A verificação é auditada.

## Limites conhecidos

- Quem controla o banco com o papel dono das tabelas pode desligar os gatilhos e **recalcular a cadeia inteira**. O encadeamento detecta adulteração parcial, não uma reescrita completa. Para isso, o resumo do último evento (`headHash`) precisa ser guardado fora do banco de tempos em tempos (ancoragem), e os papéis do banco precisam ser separados. Os dois itens estão na lista do que fazer antes de produção.
- Gravar eventos da mesma organização fica em fila (a trava da cadeia). Para o volume de uma clínica, isso não pesa; se pesar, a cadeia pode ser dividida por período.

## Painel

`GET /audit/events` (administrador) passa a aceitar também os filtros `patientId`, `resourceType`, `action` e `after`, e devolve `chainSeq` em cada evento. As telas chegam na segunda parte da Etapa 7.

## Permissões

| Rota                | Médico | Secretária | Administrador |
| ------------------- | ------ | ---------- | ------------- |
| `GET /audit/events` | —      | —          | ver           |
| `GET /audit/verify` | —      | —          | ver           |
