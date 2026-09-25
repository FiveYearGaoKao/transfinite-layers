import { gameName, gameVersion } from '@/data/constants'
import { randInt } from '@/tools/utils'
import { player } from '@/data/player'
import { format } from '@/tools/format'
import { getBase, getHighestActiveLayer, getLayerName, getPoints } from '@/access'
type newsItem = string | (() => string)
const NEWS: newsItem[] = [
  //Hello World
  `console.log("Hello ${gameName} ${gameVersion} !")`,
  `std::cout<<"Hello"<<"${gameName}"<<"${gameVersion}"<<std::endl;`,
  `print("Hello ${gameName} ${gameVersion} !")`,
  //滚动新闻
  '这是一条滚动新闻.',
  '这是另一条滚动新闻.',
  '这是一条真·滚动新闻',
  '滚动新闻里面可以添加格式,就像这样:\
    <span style="color:red">红</span>\
    <span style="color:orange">橙</span>\
    <span style="color:yellow">黄</span>\
    <span style="color:green">绿</span>\
    <span style="color:cyan">青</span>\
    <span style="color:blue">蓝</span>\
    <span style="color:magenta">紫</span>',
  () => `本游戏一共有${NEWS.length}条新闻,你可以收集一下.`,
  () => `当前时间:${new Date().toLocaleTimeString()}`,
  () => `今天是${new Date().toLocaleDateString()}`,
  '本游戏的新闻大部分都没有意义.',
  '<span style="font-size:4px">看不见我</span>',
  '我们对新闻的随机数做了修改,你不会连续看到两条相同的新闻.',
  '猜猜你要过多久才能再次看到这条新闻?',
  '热知识:收集完所有新闻可以获得一个隐藏成就',
  '添加这条新闻的目的只是为了水一次更新.',
  '没有新闻就是好新闻',
  '',
  //随机数
  () => `这是一个1~10000的随机数:${randInt(1, 10001)},如果它大于9900,说明你的运气很好;\
    如果它大于9990,说明你的运气非常好;如果它大于10000,说明你开了.`,
  '想通过重写Math.random控制随机数?不存在的!',
  //增量游戏笑话
  '增量游戏核心要素之一:滚动新闻',
  '增量游戏核心要素之二:软上限',
  '增量游戏核心要素之三:时间墙',
  '增量游戏核心要素之四:存档加密',
  '我有一个增量游戏笑话,但是它<span class="softcapped">(受软上限限制)</span>',
  '我有一个增量游戏笑话,但是它被Pelle毁灭了.',
  '转生,超越,转世,飞升...接下来是什么?真的需要发明那么多名词吗?',
  '为什么很多增量游戏都有"奇点"这个东西?',
  '怎么，没有软上限就不会制作游戏了吗?--hyp cos',
  '增量游戏的核心是数字,界面没有那么重要',
  //增量哲学
  '地球OL为什么不算一种增量游戏?',
  '增量游戏中,每个升级都在推动点数增长,同样地,每个人的人生都有意义.',
  //5小时更新
  '4小时59分59.99999...秒后更新.',
  '3e47普朗克时间后更新.',
  '"5小时后更新"意味着短时间内不会更新了.',
  '5:00:00←这是一个更新倒计时,第一分钟有60秒,第二分钟有120秒,此后每一分钟的秒数都是(60+已经过的秒数)；\
    第一小时有60分钟,此后每一小时的分钟数都是(60+已经过的秒数).倒计时归零时,下一次更新就来了.',
  '不更新.',
  '等到野生狗奶过期也不会更新.',
  '我的agent额度用完了，需要等5小时才能继续写代码',
  //游戏介绍
  '♥杂鱼作者三年还没有写出一个完整的增量游戏,真是杂鱼呢~♥',
  '本游戏使用了vue.js,这是作者第一个使用vue.js和vite制作的游戏.',
  '本游戏使用break_eternity.js来储存大数,至少目前是这样.',
  '本游戏使用lz-string来编码存档,你可以尝试破解它.',
  '本游戏的代码非常烂.',
  '本游戏没有完全抄袭《反物质维度》《声望树》《质量增量重制版》《欧米伽层级》《增量冒险》等其它游戏.',
  'AI太好用了你们知道吗?',
  '本游戏的第一个正式版于2026年8月23日发布',
  //游戏机制相关
  '本游戏有ω^ω个层级,但真的有那么多吗?',
  '如果一个重置层不需要重置前面的层,那这个重置层还能叫重置层吗?',
  '"PLAYER"是一个缩写,它的意思是"Prestige LAYER".',
  '你难道没有觉得层级0和其它层级有什么不同吗?',
  '零多项式的次数应该是-Infinity,但在游戏中层级0和其它有限层级归为一类,这对吗?',
  () => `每个大层中,只有前${Math.ceil(getBase() / 2)}层和后${Math.floor(getBase() / 2)}层是有效的.`,
  '挑战2比挑战1简单难道不是常识吗?',
  //数学
  () => `${format(getPoints([0]))}很大吗?几乎所有的正整数都比它大!`,
  '"任取一个正整数,几乎所有正整数都比它大"这句话是不准确的,因为正整数集上不存在均匀的、满足可数可加性的概率分布.',
  '如果你每秒写3个数字,那么写完你的点数所用的时间比每秒写2个数字所用的时间要短.',
  '1+1=?',
  //大数梗
  '定义没有,牛B吹爆.',
  '坦克给你打了',
  '切,这才哪到哪(1,1,1,1)(2,1,1,1)(3,1,1,1)(3,1,1,0)(2,0,0,0)【BMS分析极限】\
    =λα.(Σ2-τ【α】+1-ο-Σ2-stb.【α】×(Σ2-τ【α】+1-ο-Σ2-stb.【α】×(Σ2-τ【α】+1-ο-Σ2-stb.【α】×α)))-Π0【0】',
  '你说得对,但是DNAO=(0,0,0)(1,1,1)(2,2,2)(3,3,0)...后面忘了',
  '此滚动新闻仅用于保持活跃,不针对任何人或事',
  '都在滚动新闻里拉💩是吧?全都跑不了',
  'PPS于2025年12月10日发现无穷降链,沉痛悼念,永垂不朽.',
  //音游梗
  'xxx xx xx xxxxxxx',
  'x x xxx',
  '噔~噔~咚~~~',
  'Testify',
  '你也许意识到了这件事,"无限"是掩盖未来的虚像...,前方是毁灭亦是重生.',
  '!?感叹号问号问号感叹号?!',
  //魔塔梗
  () =>
    `你解锁了${getLayerName(getHighestActiveLayer() ?? [0])}，这表明你是个勇士，但现在游戏结束了，我将在这里亲手杀死你！\
  你以为你已经非常强大了吗？嘿嘿错了，只是我今天状态不佳而已。我走了，有本事到下一层和我再打一次。`,
  '你需要购买iu31才能通过挑战5，当然你也可以不买，超限层级最有趣的地方就是升级有很多用法。',
  '哦，大王，我打不过这个时间墙，不得不逃，饶了我吧。',
  //RickRoll
  '永远不会放弃你~永远不会辜负你~永远不会跑来跑去~抛弃你~永远不会让你哭~永远不会说再见~永远不会对你说谎~伤害你~',
  '<a href="https://www.bilibili.com/video/BV1GJ411x7h7">这是一个超链接,你应该知道它代表什么.</a>',
]

let lastIndex = -1
/**新闻总数(隐藏成就"新闻收藏家"用) */
export const NEWS_COUNT = NEWS.length
export function randomNews(): string {
  let index = randInt(0, NEWS.length)
  //避免连续出现同一条新闻
  if (index == lastIndex) index = (index + 1) % NEWS.length
  lastIndex = index
  //记录已看过的新闻索引(隐藏成就)
  if (!player.seenNews.includes(index)) player.seenNews.push(index)
  const news: newsItem = NEWS[index] || ''
  return typeof news == 'function' ? news() : news
}
