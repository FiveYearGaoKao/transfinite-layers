//剧情(随游戏进度解锁)
//注意:本文本仅提供章节骨架与占位概述,具体文学文本由策划撰写(不采用AI生成的完整剧情)
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
    id: 'omega',
    title: '进位',
    text: '(文本待策划填充)你到达了层级10——十层折叠成一个新的数字 ω。世界深度到此为止:ω 之后的内容,留给未来的旅程。',
    isUnlocked: () => player.achievements.includes('a78'),
  },
]
