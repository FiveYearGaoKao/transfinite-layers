//无限元重置层:v0.1.2实现无限重置与部分无限升级
//解锁条件为成就a48(达到1.79e308点数),成就不会被重置
//import '@/logic/infinity'连带加载compute/infinity的效果注册
import { registerMetaLayer } from './registry'
import { hasAchievement } from '@/access'
import '@/logic/infinity'
import InfinityLayer from '@/components/features/infinityLayer.vue'

registerMetaLayer({
  id: 'infinity',
  name: '无限',
  isUnlocked: () => hasAchievement('a48'),
  onTick: () => {},
  component: InfinityLayer,
})
