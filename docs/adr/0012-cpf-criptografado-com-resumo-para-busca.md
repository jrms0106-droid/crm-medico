# ADR 0012: CPF criptografado no banco, com resumo HMAC para busca e unicidade

- **Status:** aceito (2026-10-19, Etapa 3)
- **Decisão:**
  - O CPF do paciente é gravado criptografado com AES-256-GCM.
  - Ao lado vai um resumo HMAC-SHA256, que tem índice único por organização e serve para a busca exata.
  - As duas chaves saem, por HKDF, de uma variável nova, `PII_ENCRYPTION_KEY`, separada da chave de MFA.
  - Em produção, a API recusa iniciar com as chaves públicas de desenvolvimento ou com as duas chaves iguais.
- **Motivo:** O CPF é o identificador pessoal mais visado em vazamentos. Com ele criptografado, uma cópia do banco ou um backup não expõe os números sem a chave. O HMAC, diferente de um SHA-256 puro, não pode ser revertido por força bruta, porque o espaço de CPFs válidos é pequeno.
- **Alternativas descartadas:**
  - CPF em texto puro: mais simples, mas expõe o dado em qualquer cópia do banco.
  - Criptografia do disco ou do banco inteiro: continua necessária na hospedagem, mas não protege contra quem lê o banco pela própria aplicação ou por um backup lógico.
  - pgcrypto no banco: a chave precisaria trafegar nas consultas SQL e poderia aparecer em logs.
- **Consequências:**
  - A busca por CPF exige o número completo. Não há busca por parte do CPF.
  - Listas mostram o CPF mascarado.
  - Trocar a chave exige um script de recriptografia, a escrever antes da produção.
  - Perder a chave significa perder os CPFs. A guarda da chave entra no plano de backup e de gestão de segredos.
- **Riscos:** Telefones, e-mail e endereço continuam em texto puro, para permitir a busca por telefone. A avaliação de risco pré-produção pode estender a criptografia a outros campos.
- **Revisar quando:** Houver exigência de criptografar outros campos, ou a hospedagem oferecer gestão de chaves (KMS) que permita trocar a chave sem novo deploy.
