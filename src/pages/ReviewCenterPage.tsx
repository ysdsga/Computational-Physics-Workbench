import { useEffect, useState } from 'react';
import { AlertOctagon, Check, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import { agentApi } from '../api/client';
import type { ReviewDecision, ReviewRequest } from '../types';

export default function ReviewCenterPage() {
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setItems(await agentApi.reviews()); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, []);
  const decide = async (id: string, decision: ReviewDecision['decision']) => { setBusy(true); try { await agentApi.decideReview(id, decision, comments[id] ?? ''); setMessage('评价决定已绑定证据快照并写入账本'); await load(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };
  return <div className="h-full overflow-y-auto bg-[#101416] p-8 text-[#e9f0ed]">
    <header className="flex items-end justify-between border-b border-[#2a3433] pb-5"><div><p className="font-mono text-[11px] uppercase tracking-[.24em] text-[#e8b45a]">Human Gate / Evidence-bound</p><h1 className="mt-1 text-2xl font-semibold">评价中心</h1><p className="mt-2 text-sm text-[#94a39f]">只审阅越界、异常与关键科学决定；普通边界内动作不逐条审批。</p></div><button onClick={load} className="flex items-center gap-2 border border-[#42514f] px-3 py-2 text-sm"><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/>刷新</button></header>
    {message && <div className="mt-5 border-l-2 border-[#62c7b2] bg-[#14211f] p-3 text-sm">{message}</div>}
    <div className="mt-6 grid gap-5 xl:grid-cols-2">{items.map(item => <article key={item.id} className="border border-[#3b4543] bg-[#151b1d]">
      <div className="flex items-start gap-3 border-b border-[#2a3433] p-5"><AlertOctagon size={20} className="mt-0.5 shrink-0 text-[#e8b45a]"/><div><div className="font-mono text-[10px] uppercase tracking-wider text-[#e8b45a]">{item.gate_type}</div><h2 className="mt-1 font-medium leading-6">{item.question}</h2><div className="mt-1 font-mono text-[10px] text-[#697874]">CTX {item.context_version_id} · {item.created_at}</div></div></div>
      <div className="space-y-4 p-5"><div><h3 className="font-mono text-[10px] uppercase text-[#697874]">Agent 建议</h3><pre className="mt-2 max-h-36 overflow-auto bg-[#0e1315] p-3 text-xs text-[#b7c3c0]">{JSON.stringify(item.recommendation, null, 2)}</pre></div><div><h3 className="font-mono text-[10px] uppercase text-[#697874]">证据 / 方案差异</h3><pre className="mt-2 max-h-44 overflow-auto bg-[#0e1315] p-3 text-xs text-[#b7c3c0]">{JSON.stringify({ evidence: item.evidence, proposal: item.proposal }, null, 2)}</pre></div><textarea value={comments[item.id] ?? ''} onChange={event => setComments(current => ({ ...current, [item.id]: event.target.value }))} placeholder="评价意见或补充要求" className="h-20 w-full border border-[#364340] bg-[#0e1315] p-3 text-sm outline-none focus:border-[#62c7b2]"/><div className="flex flex-wrap gap-2"><button onClick={() => decide(item.id, 'approve')} className="flex items-center gap-1.5 bg-[#62c7b2] px-3 py-2 text-xs font-semibold text-[#0c1615]"><Check size={14}/>批准</button><button onClick={() => decide(item.id, 'supplement')} className="flex items-center gap-1.5 border border-[#b58c4c] px-3 py-2 text-xs text-[#e8b45a]"><RotateCcw size={14}/>要求补充</button><button onClick={() => decide(item.id, 'reject')} className="flex items-center gap-1.5 border border-[#774542] px-3 py-2 text-xs text-[#e49a94]"><X size={14}/>驳回</button><button onClick={() => decide(item.id, 'terminate')} className="flex items-center gap-1.5 border border-[#774542] bg-[#241716] px-3 py-2 text-xs text-[#e49a94]"><Square size={13}/>终止路线</button></div></div>
    </article>)}{items.length === 0 && <div className="border border-dashed border-[#364340] p-10 text-center text-sm text-[#697874] xl:col-span-2">当前没有等待评价的事项。</div>}</div>
  </div>;
}
