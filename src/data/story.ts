//剧情(随游戏进度解锁)
//注意:本文本仅提供章节骨架与占位概述,具体文学文本由策划撰写(不采用AI生成的完整剧情);
//世界观事实、术语对照与分镜参考稿见 docs/面向开发者/剧情大纲.md
import { player } from '@/data/player'

export interface StoryChapter {
  id: string
  title: string
  text: string
  /**是否已解锁 */
  isUnlocked(): boolean
}

export const STORY: StoryChapter[] = [
  {
    id: 'intro',
    title: '序章',
    text: '(文本待策划填充)你面前是一座无限高的塔。每一层都通向更高的宇宙,而攀登的代价,是抛弃脚下的一切。',
    isUnlocked: () => true,
  },
  {
    id: 'infinity',
    title: '无限',
    text: '(文本待策划填充)当点数终于越过 1.79e308,你触碰到被称为"无限"的边界。但远方的旅人告诉你:那只是一个精度的终点,真正的无限,藏在更深的层级里。',
    isUnlocked: () => player.achievements.includes('a48'),
  },
  {
    //v0.3.0:进位动画与本章正文一起实装(layerDepth 只在"最高阶窗口满时点解锁"这一步进位后才会≥2)
    id: 'omega',
    title: '进位',
    text: '(文本待策划填充)层级0~9 填满了整个世界。再往上是 ω:自然数层级(层级10、层级11…)可以一直延长下去,而 ω 的重置会把它们全部抹掉。',
    isUnlocked: () => player.layerDepth >= 2,
  },
]
