import { t } from '../i18n';
import type { GoalAssessment, ResearchMap, ScientificGoal } from '../types';

export default function TheoryResearchPanel({ map, goal, assessment }: { map: ResearchMap; goal?: ScientificGoal; assessment?: GoalAssessment }) {
  const routeLabels = { explore: t("探索中", "Exploring"), resolved: t("路线已解决", "Route resolved"), falsified: t("路线已证伪", "Route falsified"), deferred: t("暂缓 · 未决", "Deferred · unresolved"), follow_up: t("后续 · 未决", "Follow-up · unresolved") };
  const goalLabels = { unanswered: t("尚未回答", "Unanswered"), partial: t("部分成果 · 目标未达成", "Partial results · goal not met"), answered: t("已有目标回答 · Agent 评估", "Goal answered · agent assessment") };
  const question = goal ?? map.scientificGoal;
  return <section aria-label={t("理论研究地图与科学目标", "Theory research map and scientific goal")} className="space-y-4 border border-[#293534] bg-[#131a1c] p-5 text-xs">
    <h2 className="text-base font-medium">{t("科学目标与研究地图", "Scientific goal and research map")}</h2>
    <p className="text-[#91a19d]">{t("路线结束不等于原问题已回答。这里保留跨 Run 的探索与失败；不以记录数量衡量研究深度。", "Finishing a route does not mean the original question is answered. Explorations and failures are retained across runs; record counts do not measure research depth.")}</p>
    {question ? <div className="space-y-2 border-l-2 border-[#67c9b5] pl-3">
      <h3 className="font-medium">{t("原科学问题", "Original scientific question")}</h3><p>{question.question}</p>
      <div className="text-[#dfb26a]">{assessment ? goalLabels[assessment.status] : t("等待对原科学目标作出评估", "Awaiting assessment of the original scientific goal")}</div>
      {assessment && <p>{assessment.answer}</p>}
      {!!assessment?.remainingGaps.length && <ul className="list-disc space-y-1 pl-4 text-[#edc57e]">{assessment.remainingGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
      <details><summary className="cursor-pointer text-[#91a19d]">{t("原始完成标准与不足以结项的结果", "Original success criteria and insufficient outcomes")}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{question.successCriteria.map(item => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-[#dfb26a]">{t('仍不足以回答：', 'Insufficient to answer: ')}{question.insufficientOutcomes.join(t('；', '; '))}</p></details>
    </div> : <p className="text-[#dfb26a]">{t("旧 Run 尚无结构化科学目标；历史 completed 状态不代表已通过新的科学目标审查。", "This older run has no structured scientific goal. Its historical completed status does not imply it passed the current scientific goal review.")}</p>}
    <details><summary className="cursor-pointer">{t(`跨 Run 路线记忆（${map.routes.length}）`, `Route memory across runs (${map.routes.length})`)}</summary>
      <div className="mt-3 max-h-80 space-y-3 overflow-auto">{map.routes.map(route => <article key={route.id} className="space-y-2 border border-[#354341] p-3">
        <div className="text-[#67c9b5]">{routeLabels[route.disposition]} · {route.idea}</div>
        <p>{route.reason}</p>{route.learning && <p>{t('所得认识与失败边界：', 'Lessons and failure boundaries: ')}{route.learning}</p>}{route.nextQuestion && <p>{t('下一问题：', 'Next question: ')}{route.nextQuestion}</p>}
        {!!route.parentIdeaIds?.length && <p className="text-[#91a19d]">{t('来自路线：', 'Parent routes: ')}{route.parentIdeaIds.join(t('、', ', '))}</p>}
        <p className="break-all font-mono text-[10px] text-[#657570]">{route.id} · {route.runId} · {route.eventId}</p>
      </article>)}</div>
    </details>
    {!!map.searches.length && <details><summary className="cursor-pointer">{t(`路线探索与地图更新（${map.searches.length}）`, `Route exploration and map updates (${map.searches.length})`)}</summary><div className="mt-3 max-h-80 space-y-3 overflow-auto">{map.searches.map(item => <article key={item.eventId} className="space-y-2 border border-[#354341] p-3">
      {item.search.directions.map((direction, index) => <p key={index}>{direction.question} — {direction.rationale}</p>)}
      <p>{t('这次学到了什么：', 'What was learned: ')}{item.search.learned}</p><p>{t('继续追问：', 'Follow-up questions: ')}{item.search.nextQuestions.join(t('；', '; ')) || t("见目标评估", "See goal assessment")}</p>
      <p className="font-mono text-[10px] text-[#657570]">{item.runId} · {item.eventId}</p>
    </article>)}</div></details>}
  </section>;
}
