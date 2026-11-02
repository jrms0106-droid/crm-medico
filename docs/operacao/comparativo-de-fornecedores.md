# Comparativo de fornecedores (2026-11-02)

> **Nada foi contratado, cotado com vendedor ou cadastrado.** Este é um levantamento em páginas
> públicas, feito por Claude a pedido do responsável, para ajudar a decidir o que cotar. Preços
> mudam e variam com câmbio, impostos e configuração: **confirme na calculadora de cada fornecedor
> antes de decidir**. Nada aqui é parecer jurídico nem declara conformidade com a LGPD; o contrato
> de cada fornecedor precisa ser lido por quem cuida da parte jurídica.

Critérios, tirados dos [requisitos de hospedagem](requisitos-de-hospedagem.md) e da
[matriz de conformidade](../conformidade/matriz-de-conformidade.md):

- **Onde ficam os dados:** dado de saúde é dado sensível (LGPD, art. 11). Ficar no Brasil evita a
  transferência internacional (art. 33), que exige uma base própria e mais cláusulas no contrato.
- **Contrato:** o fornecedor age como **operador** (art. 39): cláusulas de proteção de dados,
  aviso de incidente, eliminação ao fim do contrato e, para IA, **sem uso dos dados para treinar
  modelos**.
- **Encaixe no sistema:** PostgreSQL 16 gerenciado com backup e recuperação para um ponto no
  tempo, cofre de segredos, e um adaptador novo no gateway de IA
  ([ADR 0009](../adr/0009-gateway-de-ia-com-adaptadores.md)).
- **Custo:** a ordem de grandeza para o porte do plano: até 5 médicos e de 10 a 30 consultas por
  dia.

## 1. Hospedagem com PostgreSQL gerenciado no Brasil

| Fornecedor                                                       | Região                         | Banco gerenciado                                                                             | Custo de referência do banco (só a máquina, sem disco e backup)                                                                                                                                                                                                                  | Observações                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS** (RDS for PostgreSQL)                                     | São Paulo (sa-east-1)          | Sim, com backup automático e recuperação para um ponto no tempo                              | db.t4g.small: cerca de **US$ 50/mês** em São Paulo, contra US$ 23/mês na Virgínia ([Bytebase](https://www.bytebase.com/dbcost/rds/instance/db.t4g.small.md))                                                                                                                     | Na mesma região há cofre de segredos e o serviço de transcrição (seção 2), então banco, chaves e áudio não saem do Brasil.                        |
| **Microsoft Azure** (Database for PostgreSQL, servidor flexível) | Brazil South (São Paulo)       | Sim, com backup e recuperação para um ponto no tempo                                         | Só achei o preço de uma máquina maior que a necessária: B4ms, cerca de **US$ 409/mês** no Brasil e US$ 199/mês no leste dos EUA ([Bytebase](https://www.bytebase.com/dbcost/azure-flexible/instance/B4ms.md)). Os planos menores (B1ms, B2s) precisam ser vistos na calculadora. | O serviço de texto da Microsoft (Azure OpenAI) tem as regras de dados mais claras da seção 2. Ter tudo no mesmo fornecedor simplifica o contrato. |
| **Google Cloud** (Cloud SQL)                                     | São Paulo (southamerica-east1) | Sim                                                                                          | A página de preços não mostra São Paulo sem escolher a região. Em Iowa: US$ 0,0413 por vCPU-hora e US$ 0,007 por GiB-hora ([Google](https://cloud.google.com/sql/pricing?hl=pt-br)). Com 1 vCPU e 3,75 GiB, dá cerca de US$ 49/mês nos EUA; em São Paulo é mais caro.            | Mesma lógica das outras duas: confirmar o preço de São Paulo na calculadora.                                                                      |
| **Nuvem nacional** (por exemplo, Magalu Cloud)                   | Brasil                         | **Não confirmei** se oferece PostgreSQL 16 gerenciado com recuperação para um ponto no tempo | Sem preço público encontrado                                                                                                                                                                                                                                                     | Contrato e suporte em português e empresa brasileira. Vale pedir cotação e conferir cada item obrigatório dos requisitos antes de considerar.     |

O que se vê nos números: **em São Paulo, o banco gerenciado custa cerca do dobro do que nos EUA**,
nos dois fornecedores com preço público. Mesmo assim, recomendo São Paulo, pelo critério de onde
ficam os dados. Somando o servidor da API e do site (2 vCPU), o disco, os backups e a cópia em outra
região, o total deve ficar na casa de **algumas centenas de reais por mês**. Esta é uma estimativa,
não uma cotação.

## 2. Serviços de IA

O sistema hoje usa um **modelo simulado**. A transcrição de consultas e a leitura de exames esperam
um serviço contratado ([IA nível 2](../api/ia-nivel-2.md)).

| Serviço                                                   | Uso no CRM                                                   | Onde processa                                                                                                                                                                                                                                                                                                                      | Treina com os dados?                                                                                                                                                                  | Observações                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS Transcribe** (comum)                                | Transcrição de consulta em português                         | Disponível em São Paulo, em lote e em tempo real ([AWS](https://docs.aws.amazon.com/pt_br/general/latest/gr/transcribe.html)). Português do Brasil é suportado desde 2020 ([AWS](https://aws.amazon.com/jp/about-aws/whats-new/2020/11/amazon-transcribe-now-supports-brazilian-portuguese--japanese-and-korean/)).                | Conferir no contrato e desligar o uso para melhoria do serviço, se houver essa opção.                                                                                                 | O **Transcribe Medical só funciona em inglês dos EUA** ([AWS](https://docs.aws.amazon.com/transcribe/latest/dg/transcribe-medical.html)). Em português, o modelo é o comum, sem vocabulário médico próprio. A qualidade precisa ser testada com áudio fictício. |
| **Azure Speech** (fala para texto)                        | Transcrição de consulta em português                         | Português do Brasil é suportado ([Microsoft](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=stt)). **Não confirmei** se roda em Brazil South.                                                                                                                                                  | Conferir no contrato.                                                                                                                                                                 | É uma alternativa à AWS, caso a hospedagem fique na Microsoft.                                                                                                                                                                                                  |
| **Azure OpenAI** (modelos de texto)                       | Organizar anotações, resumo do prontuário, leitura de exames | A implantação **regional (Standard)** processa dentro da área geográfica do recurso. As implantações **Global** e **DataZone** podem processar em outros países ([Microsoft](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy)). **Não confirmei** quais modelos têm implantação regional no Brasil. | **Não.** O texto enviado e as respostas não treinam os modelos e não vão para a OpenAI ([Microsoft](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy)). | Por padrão, o texto fica guardado para **monitoramento de abuso**. O cliente pode pedir para desligar a guarda e a revisão humana. Para dado de saúde, esse pedido é necessário.                                                                                |
| **Amazon Bedrock** (modelos de texto, por exemplo Claude) | Organizar anotações, resumo do prontuário, leitura de exames | Depende do modelo. Muitos modelos só são oferecidos por **perfis entre regiões**, que levam o pedido para fora da região de origem. A própria AWS avisa que o nome do perfil não garante o destino ([AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)).                                  | Conferir no contrato do Bedrock.                                                                                                                                                      | Antes de usar, é preciso listar a partir de São Paulo os destinos de cada perfil. Se algum destino ficar fora do Brasil, há transferência internacional.                                                                                                        |
| **API direta de um fornecedor de modelo** (EUA)           | Igual às duas linhas acima                                   | Fora do Brasil                                                                                                                                                                                                                                                                                                                     | Depende do contrato empresarial.                                                                                                                                                      | Exige base para transferência internacional (art. 33) e contrato com cláusulas para dado de saúde. **Não recomendo** para o primeiro uso real.                                                                                                                  |

Custos de IA não foram levantados. Com 10 a 30 consultas por dia, o custo é por minuto de áudio e
por texto enviado, e tende a ser menor que o da hospedagem. Isso precisa ser confirmado na cotação.

O sistema já reduz o risco seja qual for o fornecedor:

- No nível 2, a IA só aponta frases que já existem; não reescreve nem inventa
  ([ADR 0030](../adr/0030-ia-nivel-2-so-reorganiza-frases.md)).
- O histórico de pedidos à IA não guarda texto clínico.
- Os interruptores de cada função começam desligados.

O texto das frases, porém, **vai** ao fornecedor. Por isso, onde ele é processado importa.

## 3. Assinatura ICP-Brasil para documentos médicos

Hoje a assinatura dos documentos é **interna**, sem ICP-Brasil, e o PDF diz isso
([documentos](../api/documentos.md)). Receitas e atestados que saem da clínica são conferidos pela
farmácia ou por quem recebe no validador do ITI ([validar.iti.gov.br](https://validar.iti.gov.br)).

| Caminho                                                                                                                                                                                          | Como funciona                                                                                                                                                                                                                                                                         | Custo                                                                                                                                                                                                                                                                                    | Encaixe no CRM                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plataforma de Prescrição Eletrônica do CFM**                                                                                                                                                   | Emite receita simples, receita de controlados (notificações A, B e C), atestado, pedido de exame e relatório, com conferência no validador do ITI ([CFM](https://prescricaoeletronica.cfm.org.br/)).                                                                                  | **Gratuita** para médico com inscrição ativa. O CFM também dá o certificado ICP-Brasil, do tipo A3 em nuvem, renovável sem custo ([CFM](https://prescricaoeletronica.cfm.org.br/); [Afya](https://portal.afya.com.br/carreira/certificado-digital-para-medicos-qual-e-o-melhor-modelo)). | **Fica fora do CRM.** A página não fala de integração com outros sistemas. O médico emitiria a receita lá, e o CRM guardaria só um registro de que ela foi emitida. Serve **já**, sem contratar nada.                                                       |
| **Certificado em nuvem do próprio médico, assinado pelo CRM**, usando um provedor de assinatura em nuvem credenciado pelo ITI (PSC). Exemplos: BirdID, VIDaaS, NeoID, SafeID, RemoteID, VaultID. | O CRM gera o PDF, o médico autoriza no celular e o documento volta assinado no padrão PAdES. Existem serviços que juntam vários desses provedores numa API só. Um exemplo é o Certillion, que aceita certificado A1, A3 e em nuvem ([Certillion](https://certillion.com/en/?p=9085)). | **Sem preço público** para a API. O certificado do médico pode ser o gratuito do CFM, se o provedor dele estiver entre os aceitos. **Não confirmei** qual provedor emite o certificado do CFM.                                                                                           | **Fica dentro do CRM**: o documento já assinado passa a ser guardado, como prevê o [ADR 0018](../adr/0018-documentos-medicos-com-assinatura-interna-e-pdf-na-hora.md). Exige contrato com o serviço de assinatura e uma fase de desenvolvimento com testes. |
| **Certificado A1 (arquivo) guardado no servidor**                                                                                                                                                | O servidor assina sem pedir nada no celular.                                                                                                                                                                                                                                          | Pago e renovado todo ano.                                                                                                                                                                                                                                                                | **Não recomendo.** Guardar a chave do médico no servidor permite assinar sem a ação dele, o que vai contra a regra de assinatura com reautenticação.                                                                                                        |

Os documentos de saúde que exigem ICP-Brasil (Lei 14.063/2020 e normas do CFM e da Anvisa) e a
receita de controlados precisam de **validação jurídica**. Hoje a receita simples do CRM avisa que
não serve para controlados nem antimicrobianos.

## Recomendação

1. **Hospedagem:** pedir cotação da **AWS em São Paulo**, com RDS for PostgreSQL 16, cofre de
   segredos e backup em outra região. Como segunda opção, cotar a **Azure Brazil South**. Uma nuvem
   nacional só entra se cumprir todos os itens obrigatórios dos requisitos. Com o banco, as chaves
   e a transcrição na mesma região do Brasil, não há transferência internacional.
2. **Transcrição:** quando for autorizado, testar o **Transcribe comum em São Paulo** (ou o Azure
   Speech, se a hospedagem for Microsoft) **só com áudio fictício**, medindo a qualidade em
   português com termos médicos antes de qualquer uso real.
3. **Modelo de texto:** só ligar um fornecedor real com **processamento confirmado no Brasil**,
   sem uso para treinamento e sem guarda para monitoramento de abuso (a Azure OpenAI tem esse
   pedido formal). Até lá, o modelo continua simulado.
4. **ICP-Brasil:** agora, para receitas e atestados que saem da clínica, os médicos podem usar a
   **plataforma gratuita do CFM**, fora do CRM. Para assinar dentro do CRM, pedir cotação de um
   **serviço de assinatura em nuvem** e confirmar que ele aceita o certificado gratuito do CFM.
5. **Antes de contratar qualquer um:** leitura jurídica do contrato (papel de operador, local dos
   dados, aviso de incidente, eliminação no fim) e a sua autorização por escrito.

## O que este levantamento não cobre

- Cotação real com desconto, impostos e câmbio.
- WhatsApp Business Platform, que é outra decisão ([CRM e lembretes](../api/crm-e-lembretes.md)).
- Teste prático de qualquer serviço: nada foi criado em conta de fornecedor.
- Certificação SBIS/CFM do prontuário.
