import type { GoalAssessment, ResearchMap, ScientificGoal } from '../types';

const routeLabels = { explore: '探索中', resolved: '路线已解决', falsified: '路线已证伪', deferred: '暂缓 · 未决', follow_up: '后续 · 未决' };
const goalLabels = { unanswered: '尚未回答', partial: '部分成果 · 目标未达成', answered: '已有目标回答 · Agent 评估' };

export default function TheoryResearchPanel({ map, goal, assessment }: { map: ResearchMap; goal?: ScientificGoal; assessment?: GoalAssessment }) {
  const question = goal ?? map.scientificGoal;
  return <section aria-label="理论研究地图与科学目标" className="space-y-4 border border-[#293534] bg-[#131a1c] p-5 text-xs">
    <h2 className="text-base font-medium">科学目标与研究地图</h2>
    <p className="text-[#91a19d]">路线结束不等于原问题已回答。这里保留跨 Run 的探索与失败；不以记录数量衡量研究深度。</p>
    {question ? <div className="space-y-2 border-l-2 border-[#67c9b5] pl-3">
      <h3 className="font-medium">原科学问题</h3><p>{question.question}</p>
      <div className="text-[#dfb26a]">{assessment ? goalLabels[assessment.status] : '等待对原科学目标作出评估'}</div>
      {assessment && <p>{assessment.answer}</p>}
      {!!assessment?.remainingGaps.length && <ul className="list-disc space-y-1 pl-4 text-[#edc57e]">{assessment.remainingGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
      <details><summary className="cursor-pointer text-[#91a19d]">原始完成标准与不足以结项的结果</summary><ul className="mt-2 list-disc space-y-1 pl-4">{question.successCriteria.map(item => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-[#dfb26a]">仍不足以回答：{question.insufficientOutcomes.join('；')}</p></details>
    </div> : <p className="text-[#dfb26a]">旧 Run 尚无结构化科学目标；历史 completed 状态不代表已通过新的科学目标审查。</p>}
    <details><summary className="cursor-pointer">跨 Run 路线记忆（{map.routes.length}）</summary>
      <div className="mt-3 max-h-80 space-y-3 overflow-auto">{map.routes.map(route => <article key={route.id} className="space-y-2 border border-[#354341] p-3">
        <div className="text-[#67c9b5]">{routeLabels[route.disposition]} · {route.idea}</div>
        <p>{route.reason}</p>{route.learning && <p>所得认识与失败边界：{route.learning}</p>}{route.nextQuestion && <p>下一问题：{route.nextQuestion}</p>}
        {!!route.parentIdeaIds?.length && <p className="text-[#91a19d]">来自路线：{route.parentIdeaIds.join('、')}</p>}
        <p className="break-all font-mono text-[10px] text-[#657570]">{route.id} · {route.runId} · {route.eventId}</p>
      </article>)}</div>
    </details>
    {!!map.searches.length && <details><summary className="cursor-pointer">路线探索与地图更新（{map.searches.length}）</summary><div className="mt-3 max-h-80 space-y-3 overflow-auto">{map.searches.map(item => <article key={item.eventId} className="space-y-2 border border-[#354341] p-3">
      {item.search.directions.map((direction, index) => <p key={index}>{direction.question} — {direction.rationale}</p>)}
      <p>这次学到了什么：{item.search.learned}</p><p>继续追问：{item.search.nextQuestions.join('；') || '见目标评估'}</p>
      <p className="font-mono text-[10px] text-[#657570]">{item.runId} · {item.eventId}</p>
    </article>)}</div></details>}
  </section>;
}
