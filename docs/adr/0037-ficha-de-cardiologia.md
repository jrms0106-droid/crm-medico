# ADR 0037: ficha de cardiologia no prontuário

- **Status:** aceito (2026-11-07, escolha do responsável), com os campos pendentes de conferência por cardiologista
- **Contexto:** O prontuário usa um formulário genérico (motivo, anamnese, exame físico, hipóteses com CID-10, conduta) até os médicos validarem campos por especialidade ([plano do MVP](../planejamento/04-plano-do-mvp.md), Etapa 6). O responsável é cardiologista e escolheu começar pela cardiologia, para poder conferir os campos na prática.
- **Decisão:**
  - O médico escolhe o formulário ao criar o registro: `form: "generic"` (padrão) ou `form: "cardiology"`. A versão do formulário fica gravada no registro (`generic-v1` ou `cardiology-v1`) e entra no resumo da assinatura, como já entrava. Retificação e adendo herdam o formulário do original.
  - A ficha de cardiologia tem os mesmos campos de texto do genérico e um bloco `cardiology`, todo opcional: fatores de risco (com tabagismo), antecedentes cardiovasculares, sintomas (tipo de dor torácica, classe CCS, classe NYHA), sinais vitais (com IMC calculado), eletrocardiograma, ecocardiograma, exames laboratoriais e medicações em uso.
  - Os números têm faixas largas, só para barrar erro de digitação (por exemplo, FEVE de 5% a 90%, diastólica menor que a sistólica). As faixas não dizem o que é normal e o sistema não interpreta nada: não classifica risco, não sugere conduta.
  - A API recusa (400) o bloco `cardiology` num registro do formulário genérico, ao criar, salvar e retificar.
  - A ficha preenchida conta como conteúdo para finalizar. Na leitura do registro e na cópia FHIR, ela aparece como as mesmas linhas de texto (por exemplo, "Sinais vitais: PA 142/88 mmHg; FC 72 bpm"), geradas por uma única função em `@crm/shared`. No FHIR, vira uma seção "Ficha de cardiologia" da `Composition`, só com narrativa. A cópia em JSON leva o bloco como foi gravado.
- **Motivo:** O conteúdo do registro já é JSON versionado e com resumo SHA-256, então a ficha nova não precisa de tabela nem de migração, e todo o ciclo (rascunho, versões, conflito, assinatura, retificação, bloqueio no banco) vale sem mudança. Guardar a versão do formulário permite mudar os campos depois sem invalidar registros assinados.
- **Alternativas descartadas:**
  - Tabela própria para sinais vitais e exames: duplicaria o controle de versões e da assinatura.
  - `Observation` do FHIR para cada número: exigiria códigos LOINC e unidades UCUM conferidos um a um; fica para quando os campos forem validados.
  - Liberar a ficha só para quem tem a especialidade cadastrada: a especialidade do profissional ainda não é conferida, e a escolha é do médico em cada registro.
  - Calcular escores (por exemplo, risco cardiovascular): seria sugestão clínica sem validação.
- **Consequências:** A IA nível 2 continua organizando só os campos de texto e não lê nem preenche a ficha; o resumo com fontes também usa só o texto. Os campos e as faixas precisam da conferência de um cardiologista antes de qualquer uso real; até lá a tela avisa que estão em teste.
- **Revisar quando:** O responsável conferir os campos, outra especialidade pedir ficha própria, ou a cópia FHIR precisar de `Observation` com códigos padronizados.
