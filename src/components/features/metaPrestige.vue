<script setup lang="ts">
import { computed } from 'vue'
import { format, formatWhole } from '@/tools/format'
import {
  canMetaDimensionBoost,
  dimensionCount,
  metaDimensionBoostCount,
  metaDimensionExponentBonus,
  metaDimensionRequirement,
  nextDimensionCount,
  totalBoughtDimensions,
  META_DIMENSION_EXPONENT_PER_BOOST,
  META_DIMENSION_MAX_COUNT,
} from '@/compute/metaDimension'
import { metaDimensionBoostConfirm } from '@/app/uiActions'

/**已完成的元维度提升次数 */
const boosts = computed(() => metaDimensionBoostCount())
/**能否进行下一次提升(按钮配色与禁用态共用) */
const canBoost = computed(() => canMetaDimensionBoost())
/**当前每层的维度数量 */
const dimsNow = computed(() => dimensionCount())
/**本次提升后每层的维度数量 */
const nextDims = computed(() => nextDimensionCount())
/**本次提升是否解锁一个新维度(维度数量未到上限) */
const unlocksDim = computed(() => dimsNow.value < META_DIMENSION_MAX_COUNT)
/**本次提升的指数加成覆盖到维度几(维度1~min(次数+1, 上限)) */
const exponentDims = computed(() =>
  Math.min(boosts.value.add(1).toNumber(), META_DIMENSION_MAX_COUNT),
)
/**当前各维度的累计指数加成(维度1~min(次数, 上限));次数为0时为空 */
const currentBonus = computed<{ dim: number; bonus: string }[]>(() => {
  const n = Math.min(boosts.value.toNumber(), META_DIMENSION_MAX_COUNT)
  const list: { dim: number; bonus: string }[] = []
  for (let i = 1; i <= n; i++)
    list.push({ dim: i, bonus: format(metaDimensionExponentBonus(i - 1), 2) })
  return list
})
/**当前已购维度总数与本次提升的需求 */
const bought = computed(() => totalBoughtDimensions())
const requirement = computed(() => metaDimensionRequirement())
</script>
<template>
  <div id="metaPrestige">
    <div class="card section box">
      <span class="text bold title">元维度提升({{ formatWhole(boosts) }})</span>
      <span class="text desc">
        进行无限重置，<span v-if="unlocksDim">为所有层级解锁维度{{ nextDims }}，</span>同时使维度{{
          exponentDims > 1 ? `1~${exponentDims}` : '1'
        }}指数+{{ META_DIMENSION_EXPONENT_PER_BOOST }}
      </span>
      <span class="text value">
        当前效果：
        <template v-if="currentBonus.length == 0">尚未进行元维度提升</template>
        <template v-else>
          <span v-for="b in currentBonus" :key="b.dim"
            >维度{{ b.dim }} +{{ b.bonus
            }}<template v-if="b.dim < currentBonus.length">、</template></span
          >
        </template>
      </span>
      <span class="text requirement"
        >需求：{{ formatWhole(bought) }}/{{ formatWhole(requirement) }} 维度购买总数</span
      >
      <span class="text faint">
        购买的维度总数 =
        所有层级各维度已购买次数之和。提升会强制无限重置（不获得无限点数），本次提升后需重新累积。
      </span>
      <button
        :class="['prestige', 'meta', canBoost ? 'affordable' : '']"
        :disabled="!canBoost"
        @click="metaDimensionBoostConfirm()"
      >
        元维度提升
      </button>
    </div>
  </div>
</template>
<style scoped>
div#metaPrestige {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
div.card {
  width: 340px;
  min-height: 150px;
  justify-content: flex-start;
  box-sizing: border-box;
  gap: 4px;
}
div.card span.title {
  font-size: 14px;
}
div.card span.desc,
div.card span.value,
div.card span.requirement {
  font-size: 12px;
  text-align: center;
}
div.card span.value {
  color: var(--accent);
}
div.card span.requirement {
  color: var(--strong);
}
div.card span.faint {
  font-size: 11px;
  color: var(--faint);
  text-align: center;
}
</style>
