# ADR 0018: Documentos médicos com assinatura interna, retrato congelado e PDF gerado na hora

- **Status:** aceito (2026-10-30, documentos médicos)
- **Decisão:**
  - Receitas simples, atestados, pedidos de exame, encaminhamentos e relatórios ficam em uma tabela própria (`documents.medical_documents`), com o conteúdo de cada tipo conferido por esquema e o mesmo modelo de proteção do prontuário: assinatura eletrônica interna com reautenticação, resumo SHA-256 e gatilho no banco que congela o assinado. Só o cancelamento, com motivo, é aceito depois.
  - Na assinatura, a API grava um retrato do emitente (nome, CRM/UF, especialidades e RQE), do paciente e do local. O documento assinado não muda se o cadastro do médico ou do paciente mudar depois.
  - O PDF é gerado a cada pedido a partir do documento gravado, com a biblioteca pdfkit (MIT, mantida), e não é guardado. Gerar o PDF conta como a ação `export` na política e é auditado.
  - A assinatura não usa o cabeçalho `Idempotency-Key` previsto na arquitetura: a gravação é condicional à versão e ao estado, então repetir o pedido devolve 409 e não duplica nada.
- **Motivo:** Reaproveitar o modelo já testado do prontuário mantém uma única forma de assinar e de proteger. O retrato é o que garante que o documento impresso continue igual ao assinado. Gerar o PDF na hora evita guardar mais uma cópia de dado clínico; como o conteúdo e o retrato estão congelados, o PDF sai igual a cada vez.
- **Alternativas descartadas:**
  - Assinatura ICP-Brasil agora: exige provedor pago, contratação autorizada e validação jurídica do nível exigido por tipo de documento.
  - pdf-lib: sem versão nova desde 2022.
  - Gerar o PDF no navegador: a autorização e a auditoria da exportação ficariam fora do backend.
  - Guardar o PDF assinado: só faz sentido junto com a assinatura ICP-Brasil, quando o arquivo assinado passa a ser o documento.
- **Consequências:** Uma dependência nova na API (pdfkit e as dependências dela). O PDF usa as fontes padrão do PDF (Helvetica), que cobrem os acentos do português.
- **Revisar quando:** A assinatura ICP-Brasil for contratada (o PDF assinado passa a ser guardado), houver verificação pública de autenticidade ou os campos de cada documento forem validados pelos médicos.
