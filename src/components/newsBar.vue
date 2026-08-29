<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNews } from '@/app/news'
import { settings } from '@/app/settings'
import { unlockSecretFlag } from '@/access'

const containerRef = ref<HTMLElement>()
const textRef = ref<HTMLElement>()
const newsText = ref('')
/**点击新闻内的超链接(rickroll)触发隐藏成就 */
function onNewsClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName == 'A') unlockSecretFlag('rickroll')
}
/**新闻位置(px)，从右侧出现并不断左移 */
const pos = ref(0)
/**滚动速率(px/s) */
const speed = 100
let containerWidth = 0
let textWidth = 0
let lastTime = 0
let raf = 0

/**随机抽取下一条新闻并置于右侧 */
function nextNews() {
  newsText.value = randomNews()
  pos.value = containerWidth
  nextTick(() => {
    textWidth = textRef.value?.offsetWidth ?? 0
  })
}
/**每帧将新闻向左移动，完全消失后换下一条 */
function tick(now: number) {
  const dt = (now - lastTime) / 1000
  lastTime = now
  pos.value -= speed * dt
  if (pos.value + textWidth < 0) nextNews()
  raf = requestAnimationFrame(tick)
}
onMounted(() => {
  containerWidth = containerRef.value?.clientWidth ?? 0
  lastTime = performance.now()
  nextNews()
  raf = requestAnimationFrame(tick)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
})
/**窗口大小变化时更新容器宽度 */
function onResize() {
  containerWidth = containerRef.value?.clientWidth ?? 0
}
</script>
<template>
  <div id="newsBar" v-if="settings.showNews">
    <div ref="containerRef" class="newsContainer" @click="onNewsClick">
      <span
        ref="textRef"
        class="newsText"
        :style="{ transform: `translateX(${pos}px) translateY(-50%)` }"
        v-html="newsText"
      ></span>
    </div>
  </div>
</template>
<style lang="css" scoped>
div#newsBar {
  width: 100%;
  height: 32px;
  border: 2px solid var(--dim);
  border-bottom: none;
  box-sizing: border-box;
}
div.newsContainer {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
.newsText {
  font-size: 16px;
  color: var(--text);
  position: absolute;
  left: 0;
  top: 50%;
  white-space: nowrap;
}
</style>
