# ADR 0015: Assinatura interna com resumo SHA-256 e registro congelado no banco

- **Status:** aceito (2026-10-19, Etapa 6)
- **Decisão:**
  - A assinatura do MVP é a **assinatura eletrônica interna**: o autor confirma a senha (e o código MFA) logo antes de assinar, e a API grava o SHA-256 do conteúdo canônico do registro (JSON com as chaves em ordem) e as evidências (sessão, momento da reautenticação, IP e identificador da requisição).
  - O congelamento do registro assinado fica **no banco**: o gatilho `records.protect_record` recusa qualquer alteração de conteúdo ou metadados de registros assinados, retificados, arquivados ou descartados, e qualquer `DELETE`. Versões, eventos e justificativas de acesso são tabelas somente-acréscimo.
  - Correções nunca alteram o original: retificação e adendo são registros novos, ligados ao original, com justificativa.
  - A leitura recalcula o resumo e informa `integrity: valid | invalid`.
- **Motivo:** Uma regra só na API não protege contra um erro de código, um script de manutenção ou acesso direto ao banco. Com o gatilho, a garantia vale para qualquer caminho que use o usuário da aplicação, e o resumo detecta alterações feitas por quem conseguir contornar o gatilho.
- **Alternativas descartadas:**
  - Assinatura ICP-Brasil já no MVP: depende de certificado do médico, de fornecedor e de validação jurídica sobre quais registros a exigem. Fica para a fase de documentos.
  - Proteção só na camada de serviço: não resiste a SQL direto.
  - Guardar cada registro assinado só como arquivo imutável (por exemplo, em armazenamento WORM): mais infraestrutura do que o MVP precisa; pode complementar depois.
- **Consequências:**
  - O nível de assinatura exigido para cada tipo de registro (Res. CFM 1.821/2007, Lei 14.063/2020) precisa de **validação jurídica**. Não declaramos conformidade.
  - Mudar o formato canônico invalida os resumos antigos; por isso o registro guarda a versão do formulário, e uma mudança de formato precisa de uma versão nova do cálculo.
- **Riscos:** O usuário da aplicação ainda é dono das tabelas e poderia desligar o gatilho (o teste mostra que, nesse caso, a integridade aparece inválida). Separar o papel das migrações do papel da API está na lista do que fazer antes de produção.
- **Revisar quando:** Entrar a assinatura ICP-Brasil, a auditoria encadeada por hash (Etapa 7) ou a separação de papéis no banco.
