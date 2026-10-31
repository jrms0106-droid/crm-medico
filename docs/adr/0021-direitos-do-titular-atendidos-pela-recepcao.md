# ADR 0021: Direitos do titular atendidos pela recepção, com relatório tirado da auditoria e exportação em JSON

- **Status:** aceito (2026-10-31, direitos do paciente)
- **Decisão:**
  - Os pedidos do titular (LGPD art. 18) ficam em `privacy.subject_requests`, com prazo calculado (15 dias corridos, a validar) e resposta gravada uma vez; gatilho no banco impede apagar e alterar.
  - Novo recurso de política `patient_rights`, só da secretária: ver e registrar pedidos, responder, gerar o relatório de acessos e exportar. O administrador não vê pacientes e o médico já tem o prontuário pelas regras do vínculo.
  - O relatório de acessos é lido da trilha de auditoria (índice novo por paciente e data). Mostra quem, quando, o quê e o resultado, nunca o conteúdo.
  - A exportação é um arquivo JSON (formato aberto, versão 1), exige reautenticação recente porque traz o CPF, e fica auditada como `export`. A parte clínica não entra até o responsável decidir quem gera a cópia do prontuário.
- **Motivo:** A recepção é onde o paciente faz o pedido e quem já vê cadastro, agenda e financeiro. Ler o relatório da auditoria evita uma segunda trilha que poderia divergir. JSON atende à portabilidade e pode virar PDF depois.
- **Alternativas descartadas:**
  - Dar ao administrador o atendimento dos pedidos: ele passaria a ver pacientes, o que a política proíbe hoje.
  - PDF como formato principal: bom para leitura, ruim para portabilidade; pode ser acrescentado.
  - Exportar a parte clínica pela secretária: ela não tem acesso clínico.
- **Consequências:** A secretária vê, no relatório, quais profissionais acessaram os dados do paciente (sem conteúdo). O relatório tem limite de 2000 linhas por consulta; períodos longos pedem filtro.
- **Revisar quando:** O responsável decidir quem gera a cópia clínica, o encarregado de dados definir prazos e formatos, ou houver um portal do paciente.
