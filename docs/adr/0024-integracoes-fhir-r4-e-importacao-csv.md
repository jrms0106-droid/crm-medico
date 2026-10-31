# ADR 0024: Cópia do prontuário em FHIR R4 e importação de pacientes por CSV

- **Status:** aceito (2026-10-31, fase Integrações)
- **Decisão:**
  - A cópia do prontuário ganha uma segunda forma, um `Bundle` FHIR R4 do tipo `collection`, gerada a partir da mesma cópia em JSON próprio (mesmas regras de acesso, mesma auditoria). A conversão é uma função pura em `apps/api/src/integrations/fhir-copy.ts`, tipada com `@types/fhir` (só tipos, sem código em execução).
  - Registros viram `Composition` com seções LOINC; hipóteses viram `Condition` provisória com CID-10; documentos viram `DocumentReference` com o conteúdo em anexo JSON; o que ficou de fora vai num `OperationOutcome`.
  - A importação de pacientes é por CSV, em dois passos (conferir sem gravar e importar só as linhas prontas), pelo mesmo caminho do cadastro manual. Leitor de CSV próprio em `@crm/shared` (sem biblioteca nova). Novo recurso de autorização `patient_import`, só para a secretária.
  - Consentimentos de comunicação nunca vêm da planilha.
  - O limite do corpo JSON da API passou de 100 KB (padrão) para 1 MB, para caber a planilha de até 256 KB.
- **Motivo:** O FHIR é o padrão de troca usado também pela RNDS; partir da cópia existente garante que o arquivo FHIR nunca mostre mais do que a cópia permite. CSV é o que qualquer sistema e o Excel exportam. Conferir antes de gravar evita cadastro errado ou duplicado em massa.
- **Alternativas descartadas:**
  - Biblioteca de FHIR completa (servidor HAPI, `fhir-kit-client`): pesada para gerar um arquivo; útil quando houver troca com um servidor FHIR.
  - `Bundle` do tipo `document` assinado: exigiria assinatura digital (ICP-Brasil), que depende de serviço contratado.
  - Importar planilha Excel (`.xlsx`) direto: exigiria biblioteca de leitura de arquivos binários; o Excel salva em CSV.
  - Deixar o médico importar: a importação em massa é tarefa da recepção; o médico continua cadastrando um a um.
- **Consequências:** O arquivo FHIR segue a estrutura do R4, mas não foi validado pelo validador oficial da HL7 nem pelos perfis da RNDS (o validador precisa baixar pacotes de um servidor que o ambiente de desenvolvimento não alcança). A importação confere duplicidade linha a linha (até 500 linhas), o que é lento para arquivos maiores, mas suficiente para o porte de uma clínica.
- **Revisar quando:** Houver integração com a RNDS ou com outro servidor FHIR (perfis brasileiros, CPF/CNS, validação oficial), importação de dados clínicos de outro sistema ou arquivos com milhares de pacientes.
