# Histórico de alterações

As mudanças ainda não publicadas ficam em **Não publicado**. Cada implantação
expõe o commit efetivo em `/api/health.php` (`TRACE_COMMIT`); esse identificador
é a referência para comparar o histórico abaixo com o código servido. Ao criar
um release, mova os itens para uma seção com a versão/tag e a data reais.

## Não publicado

- Alinhado o perfil padrão do gateway industrial à leitura Modbus comprovada em
  bancada no INVT TS621: unidade 1, função 3 e endereço 2052. O IP e a porta
  continuam sendo obtidos do cadastro da Dala, e o gateway só publica `ONLINE`
  após validar o quadro recebido.
- Mantidas as proteções CSRF e de limite de tentativas de login/ativação mesmo
  quando as antigas variáveis de teste estiverem definidas.
- Restringido o sistema de arquivos do MySQL, mantendo o processo como UID 999,
  com áreas temporárias graváveis, sem capacidades Linux e sem ganho de privilégios.
- Padronizado o checkout do workflow de deploy de teste na versão 5.
- Documentada a necessidade de root no passo único de preparação do volume
  persistente do Node-RED.
- Adicionada verificação de módulos JavaScript sem referência nas telas.

## Releases anteriores

O histórico anterior não foi reconstruído aqui para não atribuir mudanças a
versões sem evidência. Consulte as tags e o histórico Git para releases passados.
