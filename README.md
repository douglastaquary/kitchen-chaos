# Kitchen Chaos

Demo de um jogo de cozinha estilo *Overcooked* para o navegador: você contra um chef rival (bot) numa cozinha espelhada. Sirva os pedidos antes que expirem. Ganha quem tiver mais moedas quando o relógio zerar.

Feito com **Three.js + TypeScript + Vite**. Todos os modelos 3D (chefs, fogões, panelas, caixotes, ingredientes, decoração) são gerados proceduralmente por um script Python do **Blender** e exportados como um único GLB.

## Como jogar

| Ação | Teclado | Toque |
| --- | --- | --- |
| Mover | `WASD` / setas | analógico |
| Pegar / largar / combinar | `E` / `Espaço` | **Grab** |
| Picar (segurar) | `F` | **Chop** |
| Dash | `Shift` | **Dash** |
| Pausar | `Esc` / `P` | botão ⏸ |

**Pratos do dia**

| Prato | Como fazer | Moedas |
| --- | --- | --- |
| Big Bonk Burger | pão + hambúrguer frito + alface picada + tomate picado | 30 |
| Sad Tomato Soup | 3 tomates picados na panela | 20 |
| Noodle Rumble | 2 macarrões na panela | 24 |
| Rabbit Food | alface picada + tomate picado | 16 |
| Lonely Burger | pão + hambúrguer frito | 18 |

Pegue um prato na pilha, monte os ingredientes nele e entregue na janela listrada. Entregar rápido rende gorjeta, e entregas seguidas rendem bônus de sequência. Pedido expirado custa 5 moedas. Comida esquecida no fogo queima.

## Desenvolvimento

```bash
npm install
npm run dev          # http://127.0.0.1:5188
npm run build        # gera dist/
npm run preview      # testa o build de produção em http://127.0.0.1:4188
```

- `?debug` abre um painel lil-gui para ajustar velocidade, bot e exposição.
- `?autoplay` faz a IA controlar o seu chef (usado no playtest automático).
- `npm run playtest:bot` joga uma partida inteira em autoplay e grava métricas em `artifacts/full-match/`.

### Regenerar os modelos 3D (Blender)

```bash
npm run assets       # roda blender/build_assets.py → public/assets/kitchen.glb
node blender/list_glb.mjs
```

Requer Blender 2.9+ em `/Applications/Blender.app` (ajuste o caminho no `package.json` em outros sistemas).

## Deploy no GitHub Pages

1. Crie um repositório no GitHub e faça push deste projeto na branch `main`.
2. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
3. O workflow `.github/workflows/deploy.yml` builda e publica a cada push. O `base: './'` do Vite faz o jogo funcionar em `https://<usuario>.github.io/<repo>/`.

## Estrutura

```text
blender/          script de modelagem procedural (bpy) + inspetor de GLB
public/assets/    kitchen.glb exportado pelo Blender
src/game/         layout, estações, receitas, pedidos, chef, IA do bot, orquestração
src/assets/       carregamento do GLB, visuais de itens, ícones, texturas procedurais
src/systems/      HUD, áudio (Web Audio), VFX, debug
artifacts/        design e evidências de QA
```
