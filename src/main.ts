import { createApp } from 'vue'
import App from './App.vue'
import { autoSaveLoop, mainLoop } from '@/app/core'
import { LOAD_EMPTY, getCurrentSlot, localLoad, localSave, loadSlotChoice } from '@/save/save'
import { handleFailedLoad } from '@/app/saveActions'
import { seedRng } from '@/save/rng'
import { player } from '@/data/player'
import { gameName, gameVersion, isBeta } from '@/data/constants'
import '@/compute/buyables'
import '@/meta/infinity'
import { loadSettings, applyTheme } from '@/app/settings'
//测试版在标题上标注,避免与正式版混淆(两版不共用存档,见data/constants的storagePrefix)
document.title = `${gameName} ${gameVersion}${isBeta ? ' 测试版' : ''}`
loadSettings()
applyTheme()
loadSlotChoice()
createApp(App).mount('#app')
/**开始游戏(挂上自动保存与主循环) */
function startGame() {
  //确保随机数已按存档状态播种(空槽位首次启动时用刚创建的空白档种子兜底)
  seedRng(player.rngState ?? player.seed)
  setInterval(autoSaveLoop, 1000)
  mainLoop()
}
//读档:空槽位创建新存档;槽位有内容但加载失败时不静默覆盖,由对话框决定导出或清空。
//自动保存在对话框关闭之后才开始:等待玩家选择期间没有任何写档路径,坏档不会被空白档覆盖
const loadCode = localLoad()
if (loadCode == LOAD_EMPTY) {
  localSave()
  startGame()
} else if (loadCode == 0) {
  startGame()
} else {
  void handleFailedLoad(loadCode, getCurrentSlot()).then(startGame)
}
