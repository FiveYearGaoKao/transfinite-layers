# 《超限层级》(TransfiniteLayers)

> 详细文档已拆分到 `docs/`,本文件仅作入口索引。以【代码】为准,机制变更请同步更新 docs。

## 文档入口

- 玩家向:[docs/面向玩家/玩法指南.md](./docs/面向玩家/玩法指南.md)、[docs/面向玩家/进阶攻略.md](./docs/面向玩家/进阶攻略.md)
- 开发者向:
  - [docs/面向开发者/架构.md](./docs/面向开发者/架构.md) —— 目录/依赖方向
  - [docs/面向开发者/层级系统.md](./docs/面向开发者/层级系统.md) —— 层级坐标/高度/顺序/重置/跨层规则(核心)
  - [docs/面向开发者/effect机制.md](./docs/面向开发者/effect机制.md) —— 加成管道(核心)
  - [docs/面向开发者/存档.md](./docs/面向开发者/存档.md)
  - [docs/面向开发者/开发规范.md](./docs/面向开发者/开发规范.md)
  - [docs/面向开发者/剧情大纲.md](./docs/面向开发者/剧情大纲.md) —— 世界观事实与分镜(参考稿,不进游戏)
- 基准存档(存档银行):[saves/README.md](./saves/README.md)

## 常用命令

```sh
npm run dev          # dev server (vite)
npm run build        # 删dist → type-check + build-only
npm run type-check   # vue-tsc --build
npm run lint         # eslint . --fix
npm run format       # prettier --write src/
npm run check        # 全部对撞式断言(价格/效果/存档/成就/元维度/指令/世界深度)
npm run sim          # 无头平衡模拟(参数见 docs/面向开发者/测试与平衡.md §二)
npm run saveBank     # 更新 saves/ 里的基准存档
```

## 一句话架构

`tools → data → save/access → compute → logic → meta → ui` 严格单向;
所有数值加成经 `compute/effects.ts` 管道注册;注册表模式定义各游戏系统。
