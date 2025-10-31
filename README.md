# Highliter

Extensão de navegador para Chrome/Chromium (Manifest V3) que permite criar e organizar grifos coloridos diretamente nas páginas que você visita. Cada destaque é salvo localmente por URL, podendo ser restaurado automaticamente na próxima visita.

## Instalação em modo desenvolvedor

1. Clone este repositório e abra a pasta `highliter` no seu computador.
2. No Chrome ou navegador compatível, acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/` deste projeto.
5. A extensão aparecerá na lista como **Highliter** e já poderá ser usada.

## Como usar

1. **Defina a cor ativa:**
   - Clique no ícone da extensão para abrir o popup.
   - Escolha uma das cores disponíveis; ela será usada nos próximos grifos criados.
2. **Crie um grifo:**
   - Volte para a página e selecione qualquer texto (exceto em campos editáveis).
   - O trecho selecionado é automaticamente destacado com a cor ativa e salvo no armazenamento local.
3. **Gerencie seus grifos:**
   - O popup lista todos os destaques da página atual agrupados por cor.
   - Use o filtro para exibir apenas uma cor específica ou todas ao mesmo tempo.
   - Clique em **Ir ao trecho** para rolar a página até o grifo correspondente.
   - Utilize os botões de **Copiar** (grifos filtrados) e **Exportar JSON** para compartilhar ou fazer backup das marcações.
   - O botão **Limpar página** remove todos os grifos salvos para a URL atual.
4. **Sincronização automática:**
   - Sempre que a página carregar novamente, os grifos salvos são restaurados.
   - Alterações feitas pelo popup (remoção individual ou limpeza) são refletidas instantaneamente na página.

## Organização e armazenamento

- Os grifos são persistidos em `chrome.storage.local`, agrupados por URL (sem considerar fragmentos `#hash`).
- Cada marcação contém um identificador único, cor, texto selecionado e posição no DOM para permitir restauração confiável.
- As cores padrão são **amarelo**, **verde**, **azul**, **rosa** e **laranja**, cada uma com estilos pensados para garantir contraste adequado no conteúdo destacado.

## Desenvolvimento

- Os scripts de background e content script foram escritos em JavaScript moderno e utilizam a API de mensagens para sincronização entre popup, página e service worker.
- Qualquer alteração nos arquivos dentro de `extension/` requer recarregar a extensão via `chrome://extensions` (botão **Recarregar**).

Sinta-se à vontade para adaptar as cores, estilos ou fluxo de interação conforme as necessidades do seu projeto.
