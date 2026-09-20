<script setup lang="ts">
//挑战卡片(普通挑战与无限挑战共用)
//两类挑战的差别只有三处:无限挑战不显示"进入后重置"一行、锁定信息不同、批量完成按钮的文案不同
import Decimal from 'break_eternity.js'
import { getLayerName } from '@/access'
import { format, formatWhole } from '@/tools/format'
import {
  allowBatch,
  challengeDone,
  challengeGoal,
  challengeGoalLayer,
  challengeResource,
  challengeResetTarget,
  challengeRewardValue,
  completions,
  enterChallenge,
  exitChallenge,
  isActive,
  isForcedActive,
  isInfinityChallenge,
  isUnlocked,
  maxBatchCompletions,
  type ChallengeDef,
} from '@/logic/challenges'

const props = defineProps<{ def: ChallengeDef }>()

/**目标资源文字(如"层级1点数");目标层解析不出来(挑战未解锁)时返回空 */
function goalTypeText(): string {
  const type = props.def.goalType == 'energy' ? '能量' : '点数'
  const goal = challengeGoalLayer(props.def)
  return goal ? getLayerName(goal) + type : ''
}

/**进入后重置的目标文字(无限挑战显示"无限重置";普通挑战显示目标层) */
function resetText(): string {
  if (isInfinityChallenge(props.def)) return '无限重置'
  const target = challengeResetTarget(props.def)
  return target ? getLayerName(target) : ''
}

/**进度百分比(0~100,溢出或非法时取边界) */
function progressPercent(): number {
  const ratio = Decimal.log(challengeResource(props.def).max(1), challengeGoal(props.def).max(1))
  if (!ratio.isFinite()) return 100
  return Math.max(0, Math.min(100, ratio.mul(100).toNumber()))
}

/**本次点击完成按钮预计完成的次数(至少1;解锁无限里程碑im3后可一次完成多次) */
function batchCount(): Decimal {
  return maxBatchCompletions(props.def).sub(completions(props.def)).max(1)
}

/**完成按钮文字:不允许批量时逐次完成 */
function completeButtonText(): string {
  if (!allowBatch(props.def)) return '完成'
  return `完成 ${formatWhole(batchCount())} 次`
}
</script>
<template>
  <div
    class="challenge"
    :class="[
      isInfinityChallenge(def) ? 'theme-infinity' : '',
      { active: isActive(def), locked: !isUnlocked(def) },
    ]"
  >
    <span class="text bold name">{{ def.name }}({{ formatWhole(completions(def)) }})</span>
    <span class="text">{{ def.description }}</span>
    <span v-if="!isInfinityChallenge(def)" class="text"> 进入后重置: {{ resetText() }} </span>
    <span class="text reward">奖励: {{ def.rewardText }}</span>
    <span class="text rewardValue">当前: {{ challengeRewardValue(def) }}</span>
    <div class="info">
      <span v-if="!isUnlocked(def)" class="text lockInfo">
        解锁条件:
        {{
          isInfinityChallenge(def) ? '购买无限升级IU15' : `达到${getLayerName(def.unlockLayer!)}`
        }}
      </span>
      <template v-else-if="isActive(def)">
        <span class="text">
          进度: {{ format(challengeResource(def)) }} / {{ formatWhole(challengeGoal(def)) }}
          {{ goalTypeText() }}
        </span>
        <div class="progressBar">
          <div class="progressFill" :style="{ width: progressPercent() + '%' }"></div>
        </div>
      </template>
      <span v-else class="text">
        目标: {{ formatWhole(challengeGoal(def)) }} {{ goalTypeText() }}
      </span>
    </div>
    <!--被无限挑战强制视为进入(如IC1期间的C1/C2):不可进入/退出/完成,只提示强制生效中-->
    <span v-if="isForcedActive(def)" class="text forced"> 强制生效中 </span>
    <button
      v-else-if="isUnlocked(def) && !isActive(def)"
      class="toggle selected"
      @click="enterChallenge(def)"
    >
      进入
    </button>
    <button
      v-else-if="isActive(def) && !challengeDone(def)"
      class="toggle toggle-off"
      @click="exitChallenge(def)"
    >
      提前退出
    </button>
    <button v-else-if="isActive(def)" class="toggle toggle-on" @click="exitChallenge(def)">
      {{ completeButtonText() }}
    </button>
    <button v-else class="toggle" disabled>未解锁</button>
  </div>
</template>
<style scoped>
div.challenge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  border: 2px solid var(--dim);
  padding: 6px;
  width: 240px;
  height: 260px;
  box-sizing: border-box;
  &.active {
    border-color: var(--good-border);
  }
  /*无限挑战用无限主题色表示"已进入"(放在后面以覆盖上面的普通挑战色)*/
  &.theme-infinity.active {
    border-color: var(--infinity-strong);
  }
  &.locked {
    color: var(--faint);
    opacity: 0.7;
  }
}
div.challenge .name {
  font-size: 16px;
}
div.challenge .reward {
  color: var(--good-border);
}
div.challenge .rewardValue {
  color: var(--accent);
  font-size: 13px;
}
div.challenge .lockInfo {
  color: var(--faint);
}
div.challenge .forced {
  color: var(--accent);
  font-weight: bold;
}
div.challenge .info {
  height: 48px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
div.progressBar {
  width: 100%;
  height: 12px;
  border: 1px solid var(--dim);
  background-color: var(--input-bg);
  box-sizing: border-box;
}
div.progressFill {
  height: 100%;
  background-color: var(--good-bg);
}
</style>
