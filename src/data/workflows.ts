import type { WorkflowTemplate, WorkflowStage, WorkflowStep } from '../types';

// === One-shot DFT+DMFT Workflow ===
const DFT_DMFT_ONESHOT_STAGES: WorkflowStage[] = [
  {
    id: 'prep',
    name: '准备阶段',
    color: '#3b82f6',
    colorBg: 'rgba(59,130,246,0.12)',
    colorBorder: 'rgba(59,130,246,0.4)',
    description: '确定计算目标、测试工具、准备输入文件',
  },
  {
    id: 'dft',
    name: 'DFT 计算',
    color: '#22c55e',
    colorBg: 'rgba(34,197,94,0.12)',
    colorBorder: 'rgba(34,197,94,0.4)',
    description: '结构优化、SCF、NSCF、投影态密度',
  },
  {
    id: 'wannier',
    name: 'Wannier90 计算',
    color: '#f59e0b',
    colorBg: 'rgba(245,158,11,0.12)',
    colorBorder: 'rgba(245,158,11,0.4)',
    description: 'Wannier投影、接口转换、能带验证',
  },
  {
    id: 'dmft',
    name: 'DMFT 计算',
    color: '#8b5cf6',
    colorBg: 'rgba(139,92,246,0.12)',
    colorBorder: 'rgba(139,92,246,0.4)',
    description: 'TRIQS输入、DFTTools转换、one-shot DMFT',
  },
  {
    id: 'check',
    name: '结果检查',
    color: '#ef4444',
    colorBg: 'rgba(239,68,68,0.12)',
    colorBorder: 'rgba(239,68,68,0.4)',
    description: '默认先绘制全部迭代的收敛趋势与最后一轮自能、格林函数；异常时再扩展诊断',
  },
];

const DFT_DMFT_ONESHOT_STEPS: WorkflowStep[] = [
  // === Stage 0: Preparation ===
  {
    id: 'prep-01',
    stageId: 'prep',
    order: 1,
    name: '确定计算目标',
    description: '明确要计算的体系、物性和期望的精度，选择合适的方法论。这一步决定了后续所有参数的选择。',
  },
  {
    id: 'prep-02',
    stageId: 'prep',
    order: 2,
    name: '测试 TRIQS 工具包可用性',
    description: '用一个已知的简单体系（推荐 V₂O₃ 顺磁性）先跑通整个流程，确保软件环境正确安装。',
    commands: ['mpirun -np 4 python solid_dmft.py dmft_config.ini'],
    tips: '测试材料建议 V₂O₃ 顺磁性，因为它已经被充分研究且参数成熟。',
  },
  {
    id: 'prep-03',
    stageId: 'prep',
    order: 3,
    name: '计算初始文件准备',
    description: '准备 DFT 计算所需的全部输入文件。',
    inputFiles: ['cif 结构文件', 'upf 赝势文件', 'scf.in', 'nscf.in', 'projwfc.in', 'band.in'],
    substeps: [
      { id: 'prep-03a', name: 'cif 结构文件', description: '从 Materials Project / ICSD 获取目标晶体的 cif 结构文件', files: ['*.cif'] },
      { id: 'prep-03b', name: 'upf 赝势文件', description: '从 SSSP 库下载对应元素的超软或 PAW 赝势', files: ['*.upf'] },
      { id: 'prep-03c', name: 'scf.in', description: '自洽计算输入文件，包含结构参数、k 点网格、截断能等', files: ['scf.in'] },
      { id: 'prep-03d', name: 'nscf.in', description: '非自洽计算输入文件，通常只改 calculation=\'nscf\' 并增加 k 点', files: ['nscf.in'] },
      { id: 'prep-03e', name: 'projwfc.in', description: '投影态密度输入文件', files: ['projwfc.in'] },
      { id: 'prep-03f', name: 'band.in', description: '能带计算输入文件', files: ['band.in'] },
    ],
  },
  {
    id: 'prep-04',
    stageId: 'prep',
    order: 4,
    name: 'Wannier90 投影文件准备',
    description: '准备 Wannier90 的输入文件和 QE→Wannier 的接口文件。',
    inputFiles: ['seedname.win', 'pw2wan.in'],
    substeps: [
      { id: 'prep-04a', name: 'seedname.win', description: 'Wannier90 主输入文件，定义投影轨道和能带数', files: ['seedname.win'] },
      { id: 'prep-04b', name: 'pw2wan.in', description: 'QE pw2wannier90 接口输入文件', files: ['pw2wan.in'] },
    ],
  },
  {
    id: 'prep-05',
    stageId: 'prep',
    order: 5,
    name: 'TRIQS Converter 输入准备',
    description: '准备 TRIQS DFTTools 的 converter 输入文件。',
    inputFiles: ['seedname.inp'],
    substeps: [
      { id: 'prep-05a', name: 'seedname.inp', description: 'TRIQS DFTTools Wannier90 Converter 输入，定义壳层结构', files: ['seedname.inp'] },
    ],
  },
  {
    id: 'prep-06',
    stageId: 'prep',
    order: 6,
    name: 'solid_dmft 配置准备',
    description: '准备 solid_dmft 的主配置文件。',
    inputFiles: ['dmft_config.ini'],
    substeps: [
      { id: 'prep-06a', name: 'dmft_config.ini', description: 'solid_dmft 主配置，包含 DMFT 参数、求解器设置等', files: ['dmft_config.ini'] },
    ],
  },

  // === Stage 1: DFT ===
  {
    id: 'dft-01',
    stageId: 'dft',
    order: 1,
    name: '结构优化',
    description: '对初始结构进行弛豫，找到能量最低的原子位置。对于非磁性计算，这一步是可选的。',
    commands: ['pw.x < relax.in > relax.out'],
    lsfScript: `#BSUB -J relax_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 4:00
#BSUB -o relax.out
#BSUB -e relax.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dft
module load ${`$`}{MODULE_QE}
mpirun -np ${`$`}{NPROCS} pw.x < relax.in > relax.out`,
    inputFiles: ['relax.in'],
    outputFiles: ['relax.out'],
    optional: true,
    tips: '非磁性计算且使用实验结构时，通常可以跳过。磁性计算建议做自旋极化优化。',
  },
  {
    id: 'dft-02',
    stageId: 'dft',
    order: 2,
    name: 'SCF 自洽计算',
    description: '自洽求解 Kohn-Sham 方程，得到基态电荷密度和总能量。',
    commands: ['pw.x < scf.in > scf.out'],
    lsfScript: `#BSUB -J scf_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 2:00
#BSUB -o scf.out
#BSUB -e scf.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dft
module load ${`$`}{MODULE_QE}
mpirun -np ${`$`}{NPROCS} pw.x < scf.in > scf.out`,
    inputFiles: ['scf.in'],
    outputFiles: ['scf.out'],
    tips: '确保总能收敛到 10⁻⁶ Ry 以内，k 点已收敛。',
  },
  {
    id: 'dft-03',
    stageId: 'dft',
    order: 3,
    name: 'NSCF 非自洽计算',
    description: '在固定电荷密度下，沿高对称 k 路径计算 Kohn-Sham 本征值，生成能带所需数据和 Wannier 投影所需的 Bloch 态。',
    commands: ['pw.x < nscf.in > nscf.out'],
    lsfScript: `#BSUB -J nscf_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 1:00
#BSUB -o nscf.out
#BSUB -e nscf.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dft
module load ${`$`}{MODULE_QE}
mpirun -np ${`$`}{NPROCS} pw.x < nscf.in > nscf.out`,
    inputFiles: ['nscf.in'],
    outputFiles: ['nscf.out'],
    tips: 'nscf 的 k 点网格应与 Wannier90 投影所需一致。',
  },
  {
    id: 'dft-04',
    stageId: 'dft',
    order: 4,
    name: 'PDOS 分波态密度',
    description: '计算分波态密度，用于判断费米能附近轨道成分和确定合适的能量窗口。',
    commands: ['projwfc.x < projwfc.in > projwfc.out'],
    lsfScript: `#BSUB -J pdos_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 0:30
#BSUB -o projwfc.out
#BSUB -e projwfc.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dft
module load ${`$`}{MODULE_QE}
mpirun -np ${`$`}{NPROCS} projwfc.x < projwfc.in > projwfc.out`,
    inputFiles: ['projwfc.in'],
    outputFiles: ['projwfc.out'],
    optional: true,
    tips: '此步骤有助于判断哪些轨道对费米能附近态密度贡献最大，指导 Wannier 投影选择。',
  },

  // === Stage 2: Wannier90 ===
  {
    id: 'wan-01',
    stageId: 'wannier',
    order: 1,
    name: 'Wannier90 预处理',
    description: '运行 Wannier90 预处理阶段，生成 nnkp 文件（最近邻 k 点列表）。',
    commands: ['wannier90.x -pp seedname'],
    lsfScript: `#BSUB -J wanpp_${`$`}{TASK_NAME}
#BSUB -n 1
#BSUB -W 0:10
#BSUB -o wan_pp.out
#BSUB -e wan_pp.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/wannier
module load ${`$`}{MODULE_WANNIER}
wannier90.x -pp seedname`,
    inputFiles: ['seedname.win'],
    outputFiles: ['seedname.nnkp'],
  },
  {
    id: 'wan-02',
    stageId: 'wannier',
    order: 2,
    name: 'pw2wannier90 接口计算',
    description: '读取 NSCF 输出和 nnkp 文件，计算重叠矩阵和投影矩阵。',
    commands: ['pw2wannier90.x < pw2wan.in > pw2wan.out'],
    lsfScript: `#BSUB -J pw2wan_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 1:00
#BSUB -o pw2wan.out
#BSUB -e pw2wan.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/wannier
module load ${`$`}{MODULE_QE}
mpirun -np ${`$`}{NPROCS} pw2wannier90.x < pw2wan.in > pw2wan.out`,
    inputFiles: ['pw2wan.in'],
    outputFiles: ['seedname.mmn', 'seedname.amn'],
    tips: '需要 NSCF 产生的 save 目录和 nnkp 文件在同一路径。',
  },
  {
    id: 'wan-03',
    stageId: 'wannier',
    order: 3,
    name: 'Wannier90 正式运行',
    description: '最小化 Wannier 函数的展宽，构建紧束缚哈密顿量。',
    commands: ['wannier90.x seedname'],
    lsfScript: `#BSUB -J wan_${`$`}{TASK_NAME}
#BSUB -n 1
#BSUB -W 0:30
#BSUB -o wan.out
#BSUB -e wan.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/wannier
module load ${`$`}{MODULE_WANNIER}
wannier90.x seedname`,
    inputFiles: ['seedname.win', 'seedname.mmn', 'seedname.amn'],
    outputFiles: ['seedname_hr.dat'],
    tips: '关注展宽是否合理（通常 < 5 Å²），如果不收敛可调整 disentanglement 窗口或初始投影。',
  },
  {
    id: 'wan-04',
    stageId: 'wannier',
    order: 4,
    name: 'QE 投影检查',
    description: '用 projwfc.x 做原子轨道投影，确认费米能附近主要由目标轨道（如 d 轨道）贡献。',
    commands: ['projwfc.x < projwfc.in > projwfc.out'],
    inputFiles: ['projwfc.in'],
    outputFiles: ['projwfc.out'],
    tips: '画 V-d total, V-t2g, V-eg, O-p 的投影态密度，确认费米能附近 d 主导，并了解 d 和 p 的能量分布范围。',
  },
  {
    id: 'wan-05',
    stageId: 'wannier',
    order: 5,
    name: 'Wannier 能带验证',
    description: '用 Wannier90 的 band plotting 或 TB 哈密顿量重画能带，确认 TB band 能重现 DFT band（在关心的能窗内）。',
    inputFiles: ['seedname_hr.dat'],
    outputFiles: ['seedname_band.dat'],
    tips: '此步骤是必须的！如果 TB band 和 DFT band 在目标能窗内不一致，需要重新检查 Wannier 投影和 disentanglement 设置。',
  },

  // === Stage 3: DMFT ===
  {
    id: 'dmft-01',
    stageId: 'dmft',
    order: 1,
    name: '写 TRIQS Converter 输入',
    description: '准备 TRIQS DFTTools 的 Wannier90 Converter 输入文件，定义关联壳层的结构。',
    commands: [],
    inputFiles: ['seedname.inp'],
    outputFiles: [],
    tips: 'seedname.inp 中定义每个关联原子的壳层：角动量、轨道数等。',
  },
  {
    id: 'dmft-02',
    stageId: 'dmft',
    order: 2,
    name: 'TRIQS DFTTools 转换',
    description: '用 TRIQS DFTTools 将 Wannier90 输出转换为 TRIQS 可读的 HDF5 格式。',
    commands: ['python converter.py'],
    lsfScript: `#BSUB -J conv_${`$`}{TASK_NAME}
#BSUB -n 1
#BSUB -W 0:15
#BSUB -o converter.out
#BSUB -e converter.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dmft
module load ${`$`}{MODULE_TRIQS}
python converter.py`,
    inputFiles: ['seedname.inp', 'seedname_hr.dat'],
    outputFiles: ['seedname.h5'],
    tips: '确认 h5 文件包含了正确的壳层结构和 hopping 参数。',
  },
  {
    id: 'dmft-03',
    stageId: 'dmft',
    order: 3,
    name: 'TRIQS One-shot DMFT',
    description: '用 TRIQS/solid_dmft 执行单次 DMFT 计算，不自洽更新电荷密度。',
    commands: ['mpirun -np N python solid_dmft.py dmft_config.ini'],
    lsfScript: `#BSUB -J dmft_${`$`}{TASK_NAME}
#BSUB -n ${`$`}{NPROCS}
#BSUB -W 12:00
#BSUB -o dmft.out
#BSUB -e dmft.err
cd ${`$`}{REMOTE_PATH}/${`$`}{TASK_NAME}/dmft
module load ${`$`}{MODULE_TRIQS}
mpirun -np ${`$`}{NPROCS} python solid_dmft.py dmft_config.ini`,
    inputFiles: ['dmft_config.ini', 'seedname.h5'],
    outputFiles: ['observables_imp0.dat', 'conv_imp0.dat'],
    tips: '关键参数：U, J_H, β (温度), 以及 DMFT 自洽循环次数。One-shot 通常不需要很多自洽迭代。',
  },

  // === Stage 4: Result Check ===
  {
    id: 'chk-01',
    stageId: 'check',
    order: 1,
    name: '绘制全部迭代的收敛与观测量',
    description: '读取并绘制 conv_imp*.dat 与 observables_imp*.dat（或同类文件）的全部迭代轮次，重点依据最后 5–10 轮作初步稳定性判断。',
    inputFiles: ['observables_imp*.dat', 'conv_imp*.dat', 'conv_obs*.dat'],
    outputFiles: ['dmft_recent_convergence.png', 'dmft_recent_observables.png'],
    tips: '图必须覆盖全部轮次；判断重点放在最后 5–10 轮，只报告趋于稳定、仍振荡/漂移或数据不足。',
  },
  {
    id: 'chk-02',
    stageId: 'check',
    order: 2,
    name: '绘制最后一轮自能与格林函数',
    description: '从主 HDF5 结果提取最后一轮自能和杂质/局域格林函数，按轨道与自旋绘图并保存。',
    inputFiles: ['*.h5'],
    outputFiles: ['dmft_last_sigma.png', 'dmft_last_gimp.png'],
    tips: '完成这两类图后默认停止。只有图中异常、文件矛盾、正式验收或研究者明确要求时，才追加因果性、全频率、跨副本或离线重放等诊断。',
  },
];

const WORKFLOW_STAGE_STYLES = [
  { color: '#3b82f6', colorBg: 'rgba(59,130,246,0.12)', colorBorder: 'rgba(59,130,246,0.4)' },
  { color: '#22c55e', colorBg: 'rgba(34,197,94,0.12)', colorBorder: 'rgba(34,197,94,0.4)' },
  { color: '#f59e0b', colorBg: 'rgba(245,158,11,0.12)', colorBorder: 'rgba(245,158,11,0.4)' },
  { color: '#8b5cf6', colorBg: 'rgba(139,92,246,0.12)', colorBorder: 'rgba(139,92,246,0.4)' },
  { color: '#ef4444', colorBg: 'rgba(239,68,68,0.12)', colorBorder: 'rgba(239,68,68,0.4)' },
  { color: '#06b6d4', colorBg: 'rgba(6,182,212,0.12)', colorBorder: 'rgba(6,182,212,0.4)' },
  { color: '#ec4899', colorBg: 'rgba(236,72,153,0.12)', colorBorder: 'rgba(236,72,153,0.4)' },
  { color: '#64748b', colorBg: 'rgba(100,116,139,0.12)', colorBorder: 'rgba(100,116,139,0.4)' },
] as const;

function makeWorkflowStages(
  definitions: { id: string; name: string; description: string }[],
): WorkflowStage[] {
  return definitions.map((stage, index) => ({ ...stage, ...WORKFLOW_STAGE_STYLES[index] }));
}

// === Non-magnetic QE + single Wannier90 + spontaneous magnetic DMFT ===
const QE_W90_SPONTANEOUS_STAGES = makeWorkflowStages([
  { id: 'prep', name: '准备阶段', description: '确定计算目标、检查软件环境、准备输入文件' },
  { id: 'dft_nm', name: '非磁 QE 计算', description: '结构、SCF、NSCF、能带和投影态密度' },
  { id: 'wannier_nm', name: 'Wannier90 计算', description: 'Wannier 投影、QE 接口转换和能带验证' },
  { id: 'dmft', name: 'TRIQS DMFT 计算', description: 'DFTTools 转换、基线计算和自发磁性 one-shot DMFT' },
  { id: 'check', name: '结果检查', description: '默认先绘制全部迭代的收敛趋势与最后一轮自能、格林函数；异常时再扩展诊断' },
]);

const QE_W90_SPONTANEOUS_STEPS: WorkflowStep[] = [
  {
    id: 'qenm-prep-01', stageId: 'prep', order: 1, name: '确定计算目标与技术路线',
    description: '明确研究体系、目标物性以及采用非磁 QE Hamiltonian 和自发磁性 DMFT 的原因。具体物理参数写入研究方案。',
  },
  {
    id: 'qenm-prep-02', stageId: 'prep', order: 2, name: '检查软件环境',
    description: '确认 Quantum ESPRESSO、Wannier90、TRIQS/DFTTools 和 DMFT 求解程序能够正常运行。',
  },
  {
    id: 'qenm-prep-03', stageId: 'prep', order: 3, name: '准备 QE 输入文件',
    description: '准备晶体结构、赝势以及结构优化、SCF、NSCF、能带和投影态密度所需输入。',
    inputFiles: ['*.cif', '*.upf', 'relax.in', 'scf.in', 'nscf.in', 'bands.in', 'projwfc.in'],
  },
  {
    id: 'qenm-prep-04', stageId: 'prep', order: 4, name: '准备 Wannier90 与 DMFT 输入',
    description: '准备 Wannier90、QE→Wannier90 接口、DFTTools Converter 和 DMFT 主配置文件。',
    inputFiles: ['seedname.win', 'pw2wan.in', 'seedname.inp', 'dmft_pm.toml', 'dmft_magnetic.toml'],
  },
  {
    id: 'qenm-dft-01', stageId: 'dft_nm', order: 1, name: '结构优化',
    description: '按研究方案确定是否优化结构；若直接采用实验或已有结构，可跳过此步骤。',
    commands: ['pw.x < relax.in > relax.out'],
    inputFiles: ['relax.in'], outputFiles: ['relax.out'], optional: true,
  },
  {
    id: 'qenm-dft-02', stageId: 'dft_nm', order: 2, name: '非磁 SCF 自洽计算',
    description: '用非自旋极化设置完成自洽计算，得到后续 NSCF 和 Wannier90 所需的电荷密度。',
    commands: ['pw.x < scf.in > scf.out'],
    inputFiles: ['scf.in'], outputFiles: ['scf.out'],
  },
  {
    id: 'qenm-dft-03', stageId: 'dft_nm', order: 3, name: '非磁 NSCF 计算',
    description: '在固定电荷密度下计算 Wannier90 所需的 Bloch 态，并保持与 Wannier k 网格一致。',
    commands: ['pw.x < nscf.in > nscf.out'],
    inputFiles: ['nscf.in'], outputFiles: ['nscf.out'],
  },
  {
    id: 'qenm-dft-04', stageId: 'dft_nm', order: 4, name: '能带与投影态密度',
    description: '计算能带和轨道投影信息，用于确认低能轨道成分并指导 Wannier 投影。',
    commands: ['pw.x < bands.in > bands.out', 'projwfc.x < projwfc.in > projwfc.out'],
    inputFiles: ['bands.in', 'projwfc.in'], outputFiles: ['bands.out', 'projwfc.out'], optional: true,
  },
  {
    id: 'qenm-wan-01', stageId: 'wannier_nm', order: 1, name: 'Wannier90 预处理',
    description: '运行 Wannier90 预处理，生成 QE 接口所需的 k 点邻接信息。',
    commands: ['wannier90.x -pp seedname'],
    inputFiles: ['seedname.win'], outputFiles: ['seedname.nnkp'],
  },
  {
    id: 'qenm-wan-02', stageId: 'wannier_nm', order: 2, name: 'pw2wannier90 接口计算',
    description: '由 QE 的 NSCF 结果生成 Wannier90 所需的重叠矩阵和投影矩阵。',
    commands: ['pw2wannier90.x < pw2wan.in > pw2wan.out'],
    inputFiles: ['pw2wan.in', 'seedname.nnkp'], outputFiles: ['seedname.mmn', 'seedname.amn'],
  },
  {
    id: 'qenm-wan-03', stageId: 'wannier_nm', order: 3, name: 'Wannier90 正式运行',
    description: '构建目标低能空间的 Wannier Hamiltonian。投影轨道和能窗由研究方案确定。',
    commands: ['wannier90.x seedname'],
    inputFiles: ['seedname.win', 'seedname.mmn', 'seedname.amn'], outputFiles: ['seedname_hr.dat'],
  },
  {
    id: 'qenm-wan-04', stageId: 'wannier_nm', order: 4, name: 'Wannier 能带验证',
    description: '比较 Wannier 插值能带与 QE 能带，确认关注能区内的低能 Hamiltonian 可用。',
    inputFiles: ['seedname_hr.dat'], outputFiles: ['seedname_band.dat'],
  },
  {
    id: 'qenm-dmft-01', stageId: 'dmft', order: 1, name: '写 DFTTools Converter 输入',
    description: '定义关联壳层、电子数和能量零点，准备 Wannier90Converter 所需输入。',
    inputFiles: ['seedname.inp'],
  },
  {
    id: 'qenm-dmft-02', stageId: 'dmft', order: 2, name: 'DFTTools 格式转换',
    description: '将 Wannier90 Hamiltonian 转换为 TRIQS/DFTTools 可读取的 HDF5 文件，并检查壳层和维度。',
    commands: ['python converter.py'],
    inputFiles: ['seedname.inp', 'seedname_hr.dat'], outputFiles: ['seedname.h5'],
  },
  {
    id: 'qenm-dmft-03', stageId: 'dmft', order: 3, name: '准备 DMFT 配置',
    description: '分别准备非磁基线和自发磁性计算配置。相互作用、温度、双计数和磁性初值由研究方案给出。',
    inputFiles: ['dmft_pm.toml', 'dmft_magnetic.toml'],
  },
  {
    id: 'qenm-dmft-04', stageId: 'dmft', order: 4, name: '运行非磁基线 DMFT',
    description: '从自旋对称初值运行基线计算，为判断磁性解提供对照。是否作为正式生产计算由研究方案决定。',
    commands: ['mpirun -np NPROCS python -m solid_dmft dmft_pm.toml'],
    inputFiles: ['dmft_pm.toml', 'seedname.h5'], outputFiles: ['observables_imp*.dat', 'conv_imp*.dat'], optional: true,
  },
  {
    id: 'qenm-dmft-05', stageId: 'dmft', order: 5, name: '运行自发磁性 One-shot DMFT',
    description: '从非磁 Hamiltonian 出发运行允许自旋对称性破缺的 one-shot DMFT 计算。',
    commands: ['mpirun -np NPROCS python -m solid_dmft dmft_magnetic.toml'],
    inputFiles: ['dmft_magnetic.toml', 'seedname.h5'], outputFiles: ['observables_imp*.dat', 'conv_imp*.dat'],
  },
  {
    id: 'qenm-check-01', stageId: 'check', order: 1, name: '绘制全部迭代的收敛与观测量',
    description: '读取并绘制 conv_imp*.dat 与 observables_imp*.dat（或同类文件）的全部迭代轮次，重点依据最后 5–10 轮作初步稳定性判断。',
    inputFiles: ['observables_imp*.dat', 'conv_imp*.dat', 'conv_obs*.dat'],
    outputFiles: ['dmft_recent_convergence.png', 'dmft_recent_observables.png'],
    tips: '图必须覆盖全部轮次；判断重点放在最后 5–10 轮，只报告趋于稳定、仍振荡/漂移或数据不足。',
  },
  {
    id: 'qenm-check-02', stageId: 'check', order: 2, name: '绘制最后一轮自能与格林函数',
    description: '从主 HDF5 结果提取最后一轮自能和杂质/局域格林函数，按轨道与自旋绘图并保存。',
    inputFiles: ['*.h5'],
    outputFiles: ['dmft_last_sigma.png', 'dmft_last_gimp.png'],
    tips: '完成快速图后默认停止；仅在图中异常、文件矛盾、正式验收或研究者明确要求时升级诊断。',
  },
  {
    id: 'qenm-check-03', stageId: 'check', order: 3, name: '整理电子结构结果',
    description: '基于快速图记录初步结论和计算配置；不要在没有触发条件时自动生成扩展审计。',
    outputFiles: ['results_summary.md'],
  },
];

// === WIEN2k + dmftproj + TRIQS ===
const WIEN2K_DMFTPROJ_STAGES = makeWorkflowStages([
  { id: 'prep', name: '准备阶段', description: '确定计算目标、检查软件环境、准备输入文件' },
  { id: 'wien', name: 'WIEN2k DFT 计算', description: '初始化、结构优化、自旋计算、能带和态密度' },
  { id: 'projector', name: 'dmftproj 投影', description: '准备投影输入、生成局域轨道并检查投影结果' },
  { id: 'dmft', name: 'TRIQS DMFT 计算', description: 'DFTTools 转换、DMFT 配置和 one-shot 计算' },
  { id: 'check', name: '结果检查', description: '默认先绘制全部迭代的收敛趋势与最后一轮自能、格林函数；异常时再扩展诊断' },
]);

const WIEN2K_DMFTPROJ_STEPS: WorkflowStep[] = [
  {
    id: 'wien-prep-01', stageId: 'prep', order: 1, name: '确定计算目标与技术路线',
    description: '明确研究体系、目标物性以及采用 WIEN2k、dmftproj 和 TRIQS 的计算路线。具体物理参数写入研究方案。',
  },
  {
    id: 'wien-prep-02', stageId: 'prep', order: 2, name: '检查软件环境',
    description: '确认 WIEN2k、dmftproj、TRIQS/DFTTools 和 DMFT 求解程序能够正常运行。',
    commands: ['which dmftproj'],
  },
  {
    id: 'wien-prep-03', stageId: 'prep', order: 3, name: '准备 WIEN2k 输入文件',
    description: '准备结构、原子初始化和磁性设置等 WIEN2k 输入。磁序和局域坐标定义由研究方案给出。',
    inputFiles: ['case.struct', 'case.inst'],
  },
  {
    id: 'wien-prep-04', stageId: 'prep', order: 4, name: '准备投影与 DMFT 输入',
    description: '准备 dmftproj、Wien2kConverter 和 DMFT 主配置文件。',
    inputFiles: ['case.indmftpr', 'converter.py', 'dmft_config.toml'],
  },
  {
    id: 'wien-dft-01', stageId: 'wien', order: 1, name: 'WIEN2k 初始化',
    description: '初始化计算目录并检查结构、原子球、基组和 k 点设置。具体数值由研究方案确定。',
    commands: ['init_lapw'],
  },
  {
    id: 'wien-dft-02', stageId: 'wien', order: 2, name: '结构优化',
    description: '按研究方案确定是否优化结构；若直接采用实验或已有结构，可跳过此步骤。',
    outputFiles: ['optimized.struct'], optional: true,
  },
  {
    id: 'wien-dft-03', stageId: 'wien', order: 3, name: '自旋极化 SCF 计算',
    description: '运行自旋极化 WIEN2k 自洽计算，得到收敛的电荷密度、总能和磁性信息。',
    commands: ['runsp_lapw'], outputFiles: ['case.scf'],
  },
  {
    id: 'wien-dft-04', stageId: 'wien', order: 4, name: '能带与态密度',
    description: '生成自旋分辨的能带、态密度和轨道投影信息，用于选择和检查关联子空间。',
    commands: ['x lapw2 -qtl -up', 'x lapw2 -qtl -dn', 'x tetra -up', 'x tetra -dn'],
    outputFiles: ['case.qtlup', 'case.qtldn', 'case.dos*'], optional: true,
  },
  {
    id: 'wien-proj-01', stageId: 'projector', order: 1, name: '准备 dmftproj 输入',
    description: '在 case.indmftpr 中定义关联原子、轨道和投影能窗。具体选择由研究方案确定。',
    inputFiles: ['case.indmftpr'],
  },
  {
    id: 'wien-proj-02', stageId: 'projector', order: 2, name: '生成自旋投影数据',
    description: '分别生成两个自旋通道的 dmftproj 输入数据。',
    commands: ['x lapw2 -almd -up', 'x lapw2 -almd -dn'],
    inputFiles: ['case.indmftpr'], outputFiles: ['case.almblmup', 'case.almblmdn'],
  },
  {
    id: 'wien-proj-03', stageId: 'projector', order: 3, name: '运行 dmftproj',
    description: '运行自旋极化 dmftproj，生成 DFTTools Converter 所需的投影文件。',
    commands: ['dmftproj -sp'], outputFiles: ['dmftproj.out'],
  },
  {
    id: 'wien-proj-04', stageId: 'projector', order: 4, name: '检查投影结果',
    description: '检查 dmftproj 是否正常完成，并确认关联壳层、轨道数和投影态密度与预期一致。',
    outputFiles: ['projector_check.md'],
  },
  {
    id: 'wien-dmft-01', stageId: 'dmft', order: 1, name: 'DFTTools 格式转换',
    description: '使用 Wien2kConverter 将 WIEN2k 和 dmftproj 输出写入 TRIQS 可读取的 HDF5 文件。',
    commands: ['python converter.py'], outputFiles: ['case.h5'],
  },
  {
    id: 'wien-dmft-02', stageId: 'dmft', order: 2, name: '准备 DMFT 配置',
    description: '准备 one-shot DMFT 配置。相互作用、温度、双计数、磁性初值和求解器参数由研究方案给出。',
    inputFiles: ['dmft_config.toml'],
  },
  {
    id: 'wien-dmft-03', stageId: 'dmft', order: 3, name: '运行 One-shot DMFT',
    description: '使用转换后的 HDF5 文件运行磁性 one-shot DMFT，不进行电荷自洽更新。',
    commands: ['mpirun -np NPROCS python -m solid_dmft dmft_config.toml'],
    inputFiles: ['dmft_config.toml', 'case.h5'], outputFiles: ['observables_imp*.dat', 'conv_imp*.dat'],
  },
  {
    id: 'wien-check-01', stageId: 'check', order: 1, name: '绘制全部迭代的收敛与观测量',
    description: '读取并绘制 conv_imp*.dat 与 observables_imp*.dat（或同类文件）的全部迭代轮次，重点依据最后 5–10 轮作初步稳定性判断。',
    inputFiles: ['observables_imp*.dat', 'conv_imp*.dat', 'conv_obs*.dat'],
    outputFiles: ['dmft_recent_convergence.png', 'dmft_recent_observables.png'],
    tips: '图必须覆盖全部轮次；判断重点放在最后 5–10 轮，只报告趋于稳定、仍振荡/漂移或数据不足。',
  },
  {
    id: 'wien-check-02', stageId: 'check', order: 2, name: '绘制最后一轮自能与格林函数',
    description: '从主 HDF5 结果提取最后一轮自能和杂质/局域格林函数，按轨道与自旋绘图并保存。',
    inputFiles: ['*.h5'],
    outputFiles: ['dmft_last_sigma.png', 'dmft_last_gimp.png'],
    tips: '完成快速图后默认停止；仅在图中异常、文件矛盾、正式验收或研究者明确要求时升级诊断。',
  },
  {
    id: 'wien-check-03', stageId: 'check', order: 3, name: '整理电子结构结果',
    description: '基于快速图记录初步结论和计算配置；不要在没有触发条件时自动生成扩展审计。',
    outputFiles: ['results_summary.md'],
  },
];

// === General theoretical physics research ===
const THEORETICAL_RESEARCH_STAGES = makeWorkflowStages([
  { id: 'question', name: '问题定义', description: '明确研究对象、目标观测量、物理区域与可证伪判据' },
  { id: 'context', name: '文献与约束', description: '建立已有结果、严格约束、基准事实和工作增量' },
  { id: 'model', name: '模型与假设', description: '定义自由度、理论结构、对称性、近似和适用域' },
  { id: 'baseline', name: '基准极限', description: '研究已知极限、可解情形和最小玩具模型' },
  { id: 'derivation', name: '核心推导', description: '完成主要解析论证，并记录关键依赖与未决缺口' },
  { id: 'validation', name: '一致性验证', description: '检查量纲、对称性、守恒律、已知极限和独立推导' },
  { id: 'interpretation', name: '解释与预测', description: '评估稳健性、物理机制、可检验预测与失效条件' },
  { id: 'release', name: '成果封装', description: '整理可审计的论证链、完成证据和研究报告' },
]);

function theoreticalStageReflectionStep(stageId: string, order: number, extraDescription = ''): WorkflowStep {
  return {
    id: `theory-${stageId}-reflection`, stageId, order, name: '记录、反思与下一步判断',
    description: `反思前主动从反例、竞争机制、可控极限和可检验预测等方向寻找可能改变、扩展或推翻中心结论的新想法；不设数量指标，不为凑数制造想法，未发现时简要记录已审视的方向。记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出处置。高价值想法只有在引用证据并标记为已解决或已证伪后才闭合；暂缓或转后续任务仍保持未决。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。${extraDescription}`,
    outputFiles: [`${stageId}_stage_reflection.md`],
  };
}

const THEORETICAL_RESEARCH_STEPS: WorkflowStep[] = [
  {
    id: 'theory-question-01', stageId: 'question', order: 1, name: '明确科学问题与目标观测量',
    description: '明确研究对象、控制参数、关注的物理区域和需要解释或预测的观测量。具体科学问题及其背景写入研究方案。',
    outputFiles: ['problem_statement.md'],
  },
  {
    id: 'theory-question-02', stageId: 'question', order: 2, name: '定义成功、失败与可证伪判据',
    description: '规定哪些结果构成问题得到回答、哪些结果否定当前设想，以及本次研究可以被接受的完成证据。',
    outputFiles: ['success_and_falsification_criteria.md'],
  },
  theoreticalStageReflectionStep('question', 3),
  {
    id: 'theory-context-01', stageId: 'context', order: 1, name: '建立文献与基准事实',
    description: '调用 $literature-research 系统整理严格结果、主流解释、已有解析或数值基准，以及当前理论必须满足的实验事实；覆盖里程碑、近期工作、最接近工作和可信的竞争或限制性证据，并形成逐主张的证据矩阵。',
    outputFiles: ['literature_constraints.md', 'literature_evidence_matrix.md', 'pending_literature.md'],
  },
  {
    id: 'theory-context-02', stageId: 'context', order: 2, name: '识别理论缺口与研究新增量',
    description: '比较已有路线的覆盖范围与矛盾，明确尚未解决的问题，以及本研究准备增加的理论内容。每项中心新增量必须通过 $literature-research 给出最接近的已有工作，并标记为已有、部分已有、本研究新增或与文献冲突；后续中心主张实质变化时回到本步复核。',
    outputFiles: ['novelty_statement.md', 'novelty_audit.md'],
  },
  theoreticalStageReflectionStep('context', 3, '同时审查文献覆盖是否达到当前决策所需的语义饱和：每项中心主张已有最近邻工作、近期证据和竞争解释，独立检索与前后向引文追踪不再产生新的关键机制、研究路线或更接近的前人工作，未获取文献已记录其影响。未满足时停留在本阶段或回到文献调研，不进入模型阶段。'),
  {
    id: 'theory-model-01', stageId: 'model', order: 1, name: '定义自由度与理论结构',
    description: '给出研究对象的自由度、哈密顿量、拉格朗日量或作用量、相互作用结构，以及必要的初始和边界条件。',
    outputFiles: ['model_definition.md'],
  },
  {
    id: 'theory-model-02', stageId: 'model', order: 2, name: '梳理对称性、守恒律与符号',
    description: '明确模型的连续和离散对称性、守恒量、规范约定、归一化及后续推导使用的统一符号。',
    outputFiles: ['symmetry_and_conservation.md', 'notation.md'],
  },
  {
    id: 'theory-model-03', stageId: 'model', order: 3, name: '明确近似、适用域与失效条件',
    description: '列出采用的近似、被忽略的自由度或相互作用、能标和参数范围，并说明理论在哪些条件下不再可靠。',
    outputFiles: ['assumptions_and_scope.md'],
  },
  theoreticalStageReflectionStep('model', 4),
  {
    id: 'theory-baseline-01', stageId: 'baseline', order: 1, name: '检查已知解析极限',
    description: '研究非相互作用、弱强耦合、高低温、连续或热力学极限等可控情形，整理完整理论必须恢复的结果。',
    outputFiles: ['known_limits.md'],
  },
  {
    id: 'theory-baseline-02', stageId: 'baseline', order: 2, name: '建立玩具模型或可解基准',
    description: '构造保留关键机制的最小模型或特殊可解点，用于检验直觉、符号和后续推导结果。',
    outputFiles: ['toy_model_benchmarks.md'],
  },
  theoreticalStageReflectionStep('baseline', 3),
  {
    id: 'theory-derivation-01', stageId: 'derivation', order: 1, name: '确定推导策略',
    description: '根据研究方案选择解析方法、表示、展开参数和近似层级，说明该路线为何适用于目标问题。',
    outputFiles: ['derivation_strategy.md'],
  },
  {
    id: 'theory-derivation-02', stageId: 'derivation', order: 2, name: '完成核心推导',
    description: '完成主要公式和逻辑链，保留关键中间结果，并记录对最终结论有影响的推导分支。涉及符号代数、群论、复分析、算符代数、约束求解或可数值核查的内容时，调用 $theory-derivation 选择合适工具辅助推导。',
    outputFiles: ['derivation.md'],
  },
  {
    id: 'theory-derivation-03', stageId: 'derivation', order: 3, name: '整理假设—结论依赖关系',
    description: '标明每项主要结论依赖的假设、引理和近似，记录失败路线以及尚未闭合的逻辑缺口。',
    outputFiles: ['assumption_conclusion_map.md', 'derivation_gaps.md'],
  },
  theoreticalStageReflectionStep('derivation', 4),
  {
    id: 'theory-validation-01', stageId: 'validation', order: 1, name: '执行强制一致性检查',
    description: '检查量纲、归一化、对称性、守恒律、因果性或正定性，并验证结果能够恢复研究方案要求的已知极限。',
    outputFiles: ['consistency_checks.md'],
  },
  {
    id: 'theory-validation-02', stageId: 'validation', order: 2, name: '进行独立交叉验证',
    description: '尽可能采用不同表示、替代推导、符号检查或小规模数值验证关键结论。对支撑中心结论的可工具化结果，调用 $theory-derivation 完成至少一种独立校验并保存可复查的输入、输出、假设和适用边界；无法交叉验证的部分必须明确记录。',
    outputFiles: ['cross_validation.md'],
  },
  theoreticalStageReflectionStep('validation', 3),
  {
    id: 'theory-interpretation-01', stageId: 'interpretation', order: 1, name: '分析稳健性与不确定性',
    description: '评估结论对假设、近似和参数的敏感性，识别结论稳定成立的范围并说明主要不确定性。',
    outputFiles: ['robustness_analysis.md'],
  },
  {
    id: 'theory-interpretation-02', stageId: 'interpretation', order: 2, name: '提炼物理机制',
    description: '解释控制结果的主导机制，区分普适行为与模型特有行为，并比较仍然成立的竞争解释。',
    outputFiles: ['physical_mechanism.md'],
  },
  {
    id: 'theory-interpretation-03', stageId: 'interpretation', order: 3, name: '形成预测与失效条件',
    description: '提炼可被实验、数值或后续理论检验的预测，同时明确结论的适用范围和可能失效的条件。',
    outputFiles: ['predictions_and_limits.md'],
  },
  {
    id: 'theory-interpretation-04', stageId: 'interpretation', order: 4, name: '记录、反思与探索充分性审查',
    description: '完成本阶段记录与全局探索充分性审查。主动从反例、竞争机制、可控极限和可检验预测等方向寻找可能改变、扩展或推翻中心结论的高价值问题或新想法；不设数量指标，不为凑数制造想法，未发现时简要记录已审视的方向。暂缓或转后续任务不能解除阻塞，只有引用证据的已解决或已证伪结论才能闭合。仍有未决项则回到最早受影响阶段，否则把探索审查标记为通过并进入成果封装。',
    outputFiles: ['interpretation_stage_reflection.md', 'exploration_review.md'],
  },
  {
    id: 'theory-release-01', stageId: 'release', order: 1, name: '整理可审计论证链',
    description: '把研究问题、假设、推导、验证、证据、结论和适用范围连接成可复查的完整论证链。',
    outputFiles: ['argument_map.md', 'evidence_index.md'],
  },
  {
    id: 'theory-release-02', stageId: 'release', order: 2, name: '封装成果与开放问题',
    description: '形成最终理论报告或论文草稿，列出未解决问题、失败路线和后续可以检验或扩展的方向。',
    outputFiles: ['theory_report.md', 'open_questions.md'],
  },
  theoreticalStageReflectionStep('release', 3),
];

const THEORY_RESEARCH_ADDITIONS: Record<string, string> = {
  'theory-question-01': '原科学问题跨 Run 保持可追溯；研究者确认的目标与 Agent 可修改的候选机制、模型和路线分开。不得在探索失败后把解释或预言目标悄悄替换为诊断方法或条件清单。',
  'theory-question-02': '在 Confirmed Envelope 的 scientificGoal 中明确原问题、成功标准、哪些结果仍不足以回答，以及接受的答案类型。允许有价值的否定结果；不承诺必然发表，也不以文件、验证或循环数量代替科学进展。',
  'theory-context-01': '研究地图跨 Run 持续更新，保留已知结果、未解释现象、失败路线和证据来源；恢复时读取 workbench research-map show，不重复已经排除的方向。',
  'theory-context-02': '主动纵向深挖未推导前提与可控极限，横向联系相邻体系和机制，并从矛盾、类比与失败中自主提出问题。没有 idea 时仍执行路线探索：记录实际尝试、所得认识和下一问题，不以候选清空判定研究结束。',
  'theory-model-01': '把候选机制写成物理过程到可观测结果的论证链，选择能区分竞争解释的最小模型；失败时允许在已确认方法边界内重新建模，而不是预先把待解释现象放进假设。',
  'theory-derivation-03': '区分推出的结果与尚未推出的前提；条件性结论不能自动替代原目标的解释。保留失败依赖哪条假设、实际排除了什么、尚未排除什么，以及由此产生的新问题。',
  'theory-interpretation-02': '回到原科学问题解释为什么发生、交互机制是什么、与最近先行工作相比新增了什么；辨认现象的方法不能未经确认替代产生现象的物理解释。',
  'theory-interpretation-04': '分别判断一条路线是否处理完和原科学问题是否回答。goalAssessment 必须逐项回应原始成功标准；只得到条件、缺少新增量、因果链尚缺环节或没有候选时继续找路并回流，不能标记目标达成。真正达到资源或授权边界则记录目标未达成的暂停，不伪装成成功。',
  'theory-release-02': '只有原目标达成才成功结项；部分成果、条件分析和受限暂停须如实区分。失败和研究地图作为后续轮次的起点保留，不因本轮结束丢失。',
};

function withTheoryResearchLoop(step: WorkflowStep): WorkflowStep {
  const additions = [THEORY_RESEARCH_ADDITIONS[step.id]];
  if (step.id.endsWith('-reflection')) additions.push('反思必须记录这次学到了什么、失败由哪条假设导致、排除了什么而未排除什么，以及下一步怎样改模型或提出问题。路线使用稳定 id 和 parentIdeaIds 连接，关闭时保留 learning；路线关闭不代表原问题回答。');
  return {
    ...step,
    name: step.id === 'theory-context-01' ? '建立研究地图与文献事实' : step.id === 'theory-context-02' ? '探索研究路线与提出问题' : step.name,
    description: step.description + additions.filter(Boolean).join(''),
    ...(step.id === 'theory-context-01' ? { outputFiles: [...(step.outputFiles ?? []), 'research_map.md'] } : {}),
  };
}

/** Upgrade only unchanged built-in fields; never restore deleted stages/steps or rewrite Task snapshots. */
export function upgradeTheoreticalResearchSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map(step => {
    const previous = THEORETICAL_RESEARCH_STEPS.find(item => item.id === step.id);
    if (!previous || previous.name !== step.name || previous.description !== step.description || JSON.stringify(previous.outputFiles) !== JSON.stringify(step.outputFiles)) return step;
    return withTheoryResearchLoop(step);
  });
}

// === Generic TRIQS model DMFT ===
// The workflow defines stable scientific milestones only. Model choices,
// numerical parameters, convergence thresholds, observables, and comparison
// matrices belong to the task's Research Plan and Working Plan.
const TRIQS_MODEL_DMFT_STAGES = makeWorkflowStages([
  { id: 'model', name: '模型与目标', description: '确认研究方案、计算边界与完成判据' },
  { id: 'formulation', name: 'DMFT 表述与实现', description: '将研究方案中的模型落实为可验证的 TRIQS DMFT 问题' },
  { id: 'solve', name: '自洽求解', description: '建立初态、完成 DMFT 自洽并保存收敛解' },
  { id: 'measurement', name: '收敛态测量', description: '基于收敛解完成研究方案要求的生产测量' },
  {
    id: 'validation',
    name: '一致性与验证',
    description: '按固定顺序先验证完整迭代历史是否进入稳定平台，再检查末轮自能与格林函数的物理合理性；仅在异常、矛盾、正式验收或研究方案要求时升级扩展诊断',
  },
  { id: 'release', name: '结果分析与发布', description: '回答研究问题并形成可复现的完成证据' },
]);

const TRIQS_MODEL_DMFT_STEPS: WorkflowStep[] = [
  {
    id: 'model-dmft-model-01', stageId: 'model', order: 1, name: '确认研究方案与完成判据',
    description: '确认本任务采用的研究方案、科学边界、目标观测量以及成功、失败和可证伪判据；具体模型与数值选择以研究方案为准。',
  },
  {
    id: 'model-dmft-model-02', stageId: 'model', order: 2, name: '明确模型 DMFT 计算任务',
    description: '把研究方案转化为本次模型 DMFT 需要完成的计算范围、必要对照和完成证据，不在工作流模板中固化任务专属参数。',
  },
  {
    id: 'model-dmft-model-03', stageId: 'model', order: 3, name: '检查研究方案所需计算环境',
    description: '检查研究方案指定的软件栈、依赖和运行接口是否可用且相互兼容，确认具备进入模型实现阶段的条件；安装、连接尝试和临时诊断不展开为工作流节点。',
  },
  {
    id: 'model-dmft-formulation-01', stageId: 'formulation', order: 1, name: '构建格点模型',
    description: '按研究方案实现模型的单粒子部分和格点表示，形成可供 DMFT 局域化计算使用的模型输入。',
  },
  {
    id: 'model-dmft-formulation-02', stageId: 'formulation', order: 2, name: '构建杂质问题',
    description: '按研究方案建立局域自由度、相互作用和杂质表示，确保其与格点模型及目标物理问题一致。',
  },
  {
    id: 'model-dmft-formulation-solver', stageId: 'formulation', order: 3, name: '建立杂质求解方案',
    description: '按研究方案准备与杂质问题和目标观测量相适配的 TRIQS 杂质求解方案，确认求解器接口、局域问题表示和测量能力满足本任务；具体方法和数值设置由研究方案及 Working Plan 确定。',
  },
  {
    id: 'model-dmft-formulation-03', stageId: 'formulation', order: 4, name: '建立 DMFT 自洽关系',
    description: '建立格点局域问题与杂质问题之间的自洽映射；具体方程、约束和控制方式由研究方案确定。',
  },
  {
    id: 'model-dmft-formulation-04', stageId: 'formulation', order: 5, name: '验证模型与 DMFT 实现',
    description: '在进入正式计算前验证模型映射、TRIQS 实现和必要基准，确认计算对象与研究方案一致。',
  },
  {
    id: 'model-dmft-solve-01', stageId: 'solve', order: 1, name: '准备初始计算状态',
    description: '按研究方案准备新的初始状态或可靠的重启状态，为目标 DMFT 自洽计算建立明确起点。',
  },
  {
    id: 'model-dmft-solve-02', stageId: 'solve', order: 2, name: '运行 DMFT 自洽计算',
    description: '完成目标模型的 DMFT 自洽求解；迭代控制、求解器设置和作业安排由研究方案及 Working Plan 给出。',
  },
  {
    id: 'model-dmft-solve-03', stageId: 'solve', order: 3, name: '获得并保存收敛解',
    description: '依据研究方案规定的判据确认目标物理解收敛，并保存完整迭代历史和可恢复的收敛状态。',
  },
  {
    id: 'model-dmft-measurement-01', stageId: 'measurement', order: 1, name: '准备收敛态生产计算',
    description: '以已确认的收敛解为基础，准备独立、可追溯的生产测量，冻结本次测量使用的计算条件。',
  },
  {
    id: 'model-dmft-measurement-02', stageId: 'measurement', order: 2, name: '完成目标观测量测量',
    description: '完成研究方案规定的静态、单粒子或更高阶观测量测量，不在通用模板中预设具体观测量和测量通道。',
  },
  {
    id: 'model-dmft-measurement-03', stageId: 'measurement', order: 3, name: '保存完整原始结果',
    description: '保存可用于复查和后续分析的原始测量结果、计算状态与必要元数据，保持结果来源可追溯。',
  },
  {
    id: 'model-dmft-validation-01', stageId: 'validation', order: 1, name: '绘制完整迭代历史并判断稳定平台',
    description: '每次完成 DMFT 计算后，首先读取并绘制全部可用迭代轮次的收敛量与主要观测量；结合完整历史并重点检查末 5–10 轮，判断结果是已进入稳定平台、仍在漂移或振荡，还是数据不足。不得只选择有利的局部轮次，也不得仅凭达到预设迭代数宣称收敛。',
  },
  {
    id: 'model-dmft-validation-02', stageId: 'validation', order: 2, name: '绘制末轮自能和格林函数并检查物理合理性',
    description: '在完整迭代历史显示已进入稳定平台后，从同一末轮结果绘制自能和杂质/局域格林函数的实部与虚部，并检查因果性、平滑性、高频渐近行为、对称关系和不同数据文件的一致性。只有收敛趋势与末轮单粒子量都合理，才能把该结果作为候选收敛解。',
  },
  {
    id: 'model-dmft-validation-03', stageId: 'validation', order: 3, name: '按需升级扩展验证与对照',
    description: '默认完成前两项快速验收后停止。只有收敛图或末轮自能/格林函数出现异常、关键文件互相矛盾、任务进入正式验收/发表证据阶段，或研究方案明确要求时，才追加噪声底、全频率矩阵因果性、独立种子、窗口扫描、分支对照等针对性测试；先说明触发异常与最小追加检查。',
  },
  {
    id: 'model-dmft-release-01', stageId: 'release', order: 1, name: '提取并分析目标物理结果',
    description: '围绕研究方案定义的目标观测量整理结果，提取控制现象的关联效应、物理趋势和适用范围。',
  },
  {
    id: 'model-dmft-release-02', stageId: 'release', order: 2, name: '回答研究问题与可证伪判据',
    description: '综合计算、验证和对照证据，说明研究问题得到怎样的回答，以及原有设想是否被支持、限制或否定。',
  },
  {
    id: 'model-dmft-release-03', stageId: 'release', order: 3, name: '整理可复现结果与完成证据',
    description: '封装模型说明、计算配置、原始结果、分析产物和证据索引，记录限制条件与后续开放问题。',
  },
];

// === Physics literature reproduction ===
// The workflow keeps the claim-level scientific skeleton shared by analytical
// theory, numerical model studies, and material calculations. Paper-specific
// equations, parameters, tolerances, software, and run matrices belong to the
// Research Plan and Working Plan.
const PHYSICS_LITERATURE_REPRODUCTION_STAGES = makeWorkflowStages([
  { id: 'scope', name: '范围与判据', description: '固定论文身份、复现动机、目标层级、独立性与声明边界' },
  { id: 'claims', name: '主张拆解', description: '把论文结论拆成可检验主张、依赖关系和类型化复现路线' },
  { id: 'resources', name: '资源与出处', description: '冻结正文、补充材料、代码、数据、参数出处与缺失信息' },
  { id: 'specification', name: '可执行规格', description: '将论文方法转写为带约定、参数来源、运行矩阵和证据映射的规格' },
  { id: 'pilot', name: '最小闭环', description: '先验证环境、观测量管线和最小主张路径，再进入正式复现' },
  { id: 'reproduction', name: '正式复现', description: '按冻结协议执行目标主张，保存原始结果、完整历史和偏离记录' },
  { id: 'validation', name: '对比与验证', description: '进行正确性、独立性、可比性和不确定度检查，逐项裁决主张' },
  { id: 'release', name: '封装与结论', description: '整理可重跑产物、逐主张证据链、限制和研究者审阅结论' },
]);

const PHYSICS_LITERATURE_REPRODUCTION_STEPS: WorkflowStep[] = [
  {
    id: 'repro-scope-01', stageId: 'scope', order: 1, name: '确认论文身份与复现动机',
    description: '记录论文题名、作者、DOI 或稳定标识、版本、补充材料与勘误，并说明为何复现及它与当前研究的关系。预印本、正式版本和后续修订不得混为同一来源。',
    outputFiles: ['paper_identity.md'],
  },
  {
    id: 'repro-scope-02', stageId: 'scope', order: 2, name: '选择复现深度与独立性模式',
    description: '分别选择复现深度（可运行性、核心机制、关键主张、完整结果或后续基线）和独立性模式（原作者产物复跑、独立重建或双路线交叉验证）。两者是独立维度，不用复跑成功代替独立复现。',
    outputFiles: ['reproduction_scope.md'],
  },
  {
    id: 'repro-scope-03', stageId: 'scope', order: 3, name: '定义完成、降级与声明边界',
    description: '预先规定完成证据、可比条件、允许误差和不能作为证据的结果；说明资源缺失时如何降级目标。复现完成、部分复现、未复现和条件不足无法判断必须区分，不承诺得到与论文一致的结论。',
    outputFiles: ['completion_and_claim_boundaries.md'],
  },
  {
    id: 'repro-claims-01', stageId: 'claims', order: 1, name: '建立逐主张复现台账',
    description: '为每项目标建立稳定 claim_id，记录其在论文中的位置、主张类型、控制条件、目标观测量、原文结果、验收容差和所需证据。图、表、公式、相边界、标度、趋势和机制解释应拆开记录。',
    outputFiles: ['claim_ledger.csv', 'claim_ledger.md'],
  },
  {
    id: 'repro-claims-02', stageId: 'claims', order: 2, name: '重建主张依赖与论证链',
    description: '连接模型假设、推导或算法、参数与输入、原始观测量、后处理和最终主张，标出共同上游依赖。相关图像同时成功不能被误当作多份独立证据。',
    outputFiles: ['claim_dependency_map.md'],
  },
  {
    id: 'repro-claims-03', stageId: 'claims', order: 3, name: '选择类型化复现路线',
    description: '按目标主张选择解析理论、模型数值或真实材料计算路线，可组合但不得无故执行全部路线。混合论文需说明各路线的接口、共享假设，以及哪条路线为哪项 claim 提供证据。',
    outputFiles: ['reproduction_tracks.md'],
  },
  {
    id: 'repro-resources-01', stageId: 'resources', order: 1, name: '收集并冻结来源资源',
    description: '调用 $literature-research 检索正文、补充材料、勘误、作者代码与数据、相关方法论文及必要基准；记录稳定来源、访问日期、版本或提交号、许可证和文件哈希。二手转述不能替代关键一手来源。',
    outputFiles: ['resource_manifest.json', 'source_hashes.sha256', 'pending_resources.md'],
  },
  {
    id: 'repro-resources-02', stageId: 'resources', order: 2, name: '建立参数与约定出处表',
    description: '逐项记录模型参数、材料输入、离散化、初态、边界条件、数值控制、测量和后处理约定，并将来源标为论文明确给出、由正文推导、从代码提取、引用他文、合理推断或本次自选。数值必须和物理语义、单位及适用对象绑定。',
    outputFiles: ['parameter_provenance.csv', 'conventions_and_units.md'],
  },
  {
    id: 'repro-resources-03', stageId: 'resources', order: 3, name: '评估缺失信息与替代验证',
    description: '列出缺失资源、歧义和潜在勘误，评估它们影响哪些 claim 与可比性。替代数据、近似参数或重建输入只能支持明确限定的验证；关键缺失会改变结论时，先请求研究者决定或降低复现目标。',
    outputFiles: ['ambiguity_ledger.md', 'resource_gap_assessment.md'],
  },
  {
    id: 'repro-spec-01', stageId: 'specification', order: 1, name: '统一符号、单位与观测量定义',
    description: '把论文符号、规范、单位、基底、序参量、傅里叶约定、归一化、指标和聚合方式转换为统一可执行定义；显式区分内部优化量、代理量和真正支撑论文主张的观测量。',
    outputFiles: ['observable_and_notation_spec.md'],
  },
  {
    id: 'repro-spec-theory', stageId: 'specification', order: 2, name: '制定解析理论复核规格',
    description: '针对解析理论 claim，列出起始假设、引理、推导分支、近似阶次、正则化或解析延拓、可控极限和待独立核查的关键等式；需要时调用 $theory-derivation 保存可复查的符号或数值校验。',
    outputFiles: ['analytical_reproduction_spec.md'], optional: true,
  },
  {
    id: 'repro-spec-model', stageId: 'specification', order: 3, name: '制定模型数值复现规格',
    description: '针对模型研究 claim，定义哈密顿量或作用量、格点与边界、算法、系统尺寸、扫描变量、初始化、热化或自洽、随机性、误差估计、有限尺寸或截断处理及输出观测量。具体数值写入研究方案。',
    outputFiles: ['model_numerics_reproduction_spec.md'], optional: true,
  },
  {
    id: 'repro-spec-material', stageId: 'specification', order: 4, name: '制定材料计算复现规格',
    description: '针对材料 claim，定义结构来源、电子结构方法、赝势或基组、交换关联处理、k/q 网格、低能子空间、相互作用与双计数、求解器和后处理等影响可比性的选择。所有物理参数及依据写入研究方案，不由模板预设。',
    outputFiles: ['materials_reproduction_spec.md'], optional: true,
  },
  {
    id: 'repro-spec-05', stageId: 'specification', order: 5, name: '冻结主张—运行—证据矩阵',
    description: '为每个 claim 指定必要运行、输入版本、对照、重复、输出、验证器、容差和证据路径，并区分最低复现集与可选稳健性扩展。正式执行前冻结协议；事后改动必须记录理由、影响和版本，禁止为贴合论文曲线而无痕调参。',
    outputFiles: ['claim_evidence_matrix.md', 'run_matrix.csv', 'protocol_lock.md'],
  },
  {
    id: 'repro-pilot-01', stageId: 'pilot', order: 1, name: '验证环境与输入完整性',
    description: '确认依赖、编译选项、硬件或数值后端、随机种子策略及输入哈希能够被记录和重建。若复跑作者产物，应先验证原始入口与最小示例，但其成功只证明该产物可运行。',
    outputFiles: ['environment_lock.md', 'input_integrity_check.md'],
  },
  {
    id: 'repro-pilot-02', stageId: 'pilot', order: 2, name: '验证观测量与后处理管线',
    description: '用合成数据、已知极限或手算样例测试单位转换、统计量、误差条、拟合、插值、解析延拓、作图和数字化流程。尽可能让关键指标实现独立于待复现主程序，避免共同错误制造表面一致。',
    outputFiles: ['observable_pipeline_tests.md'],
  },
  {
    id: 'repro-pilot-03', stageId: 'pilot', order: 3, name: '跑通最小主张闭环',
    description: '选择一个最小、低成本且可观察的 claim 路径，使输入经过核心推导或计算得到中间量和目标观测量，并检查数据流、符号、尺度及已知极限。最小闭环通过不等于论文结论已复现。',
    outputFiles: ['pilot_report.md', 'pilot_evidence_index.md'],
  },
  {
    id: 'repro-run-01', stageId: 'reproduction', order: 1, name: '执行冻结的目标复现矩阵',
    description: '按协议执行支撑目标 claims 的解析复核、模型数值计算或材料计算。普通命令与临时诊断只记 Event；正式提交、多运行批次和替代科学计算作为可追溯 Action，不为每次尝试新增工作流节点。',
  },
  {
    id: 'repro-run-02', stageId: 'reproduction', order: 2, name: '保存原始结果与完整演化历史',
    description: '保留配置、日志、随机种子、检查点、全部迭代或扫描历史、未处理观测量和生成图表的数据，不只保存最终图片或最有利的结果。每个产物须能追溯到 claim、运行和输入版本。',
    outputFiles: ['run_manifest.json', 'raw_results_index.md'],
  },
  {
    id: 'repro-run-03', stageId: 'reproduction', order: 3, name: '记录偏离、失败与科学重试',
    description: '记录对冻结协议的每次偏离、失败原因及其影响。环境、连接和传输问题与科学失败分开；替换失败科学运行时显式绑定重试来源，不得通过选择性重跑、删点或事后缩窄比较区间来制造一致。',
    outputFiles: ['deviation_and_retry_ledger.md'],
  },
  {
    id: 'repro-validation-01', stageId: 'validation', order: 1, name: '执行正确性与物理一致性检查',
    description: '检查输出结构、量纲、对称性、守恒律、因果性或正定性、误差传播、数值收敛和已知极限。不同路线只执行与目标 claim 相关的检查，并保存失败检查而非只报告通过项。',
    outputFiles: ['correctness_and_physics_checks.md'],
  },
  {
    id: 'repro-validation-02', stageId: 'validation', order: 2, name: '进行独立交叉验证',
    description: '用替代推导、第二实现、精确对角化或小尺寸基准、另一数值表示、独立后处理或论文提供数据核查关键中间量。若无法获得独立验证，明确记录证据相关性和剩余风险。',
    outputFiles: ['independent_cross_validation.md'],
  },
  {
    id: 'repro-validation-03', stageId: 'validation', order: 3, name: '审计可比性与差异预算',
    description: '逐项比较数据或结构版本、方法、参数、有限尺寸、收敛水平、随机与系统误差、图像数字化误差和后处理定义。先判断是否处于可比条件，再讨论数值差异；趋势相同、数值相同和机制得到支持是不同证据等级。',
    outputFiles: ['comparability_audit.md', 'discrepancy_budget.md'],
  },
  {
    id: 'repro-validation-04', stageId: 'validation', order: 4, name: '形成逐主张复现裁决',
    description: '对每个 claim 基于预定标准标记为复现、部分复现、未复现或条件不足无法判断，并引用有效证据、说明适用条件和替代解释。计算完成状态不得自动转换为科学裁决；机制性主张不能仅由拟合或视觉相似宣称成立。',
    outputFiles: ['claim_verdicts.md'],
  },
  {
    id: 'repro-release-01', stageId: 'release', order: 1, name: '整理逐主张证据链',
    description: '把来源、假设、规格、运行、原始产物、验证记录、差异解释和裁决按 claim_id 连接成可审计链，标记无效、可疑和被取代的产物，不静默覆盖来源。',
    outputFiles: ['reproduction_evidence_index.md', 'artifact_validity_register.md'],
  },
  {
    id: 'repro-release-02', stageId: 'release', order: 2, name: '封装可重跑复现包',
    description: '整理代码或推导文档、环境锁定、输入与来源清单、机器可读运行矩阵、原始及处理结果、最小重跑命令和 README。受许可或体积限制不能打包的资源，应保存获取方式、哈希和替代说明。',
    outputFiles: ['README_reproduction.md', 'reproduction_manifest.json'],
  },
  {
    id: 'repro-release-03', stageId: 'release', order: 3, name: '撰写复现报告并请求研究者审阅',
    description: '汇总成功、部分成功、未成功与无法判断的 claims，解释偏差、限制和剩余不确定性，区分论文复现与本次新增探索。最终可对外声称的结论由研究者审阅确认；新发现和扩展想法进入独立后续任务。',
    outputFiles: ['reproduction_report.md', 'limitations_and_open_questions.md', 'extension_backlog.md'],
  },
];

// === Workflow Registry ===
export const WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'dft-dmft-oneshot',
    name: 'One-shot DFT+DMFT',
    description: '单次 DMFT 计算，不自洽更新电荷密度',
    stages: DFT_DMFT_ONESHOT_STAGES,
    steps: DFT_DMFT_ONESHOT_STEPS,
  },
  {
    id: 'qe-w90-triqs-spontaneous-magnetic-oneshot',
    name: 'One-shot 非磁 QE → W90 → 自发磁性 DMFT',
    description: '非磁 QE、单套 Wannier90、DFTTools 转换与自发磁性 DMFT',
    stages: QE_W90_SPONTANEOUS_STAGES,
    steps: QE_W90_SPONTANEOUS_STEPS,
  },
  {
    id: 'wien2k-dmftproj-triqs-oneshot',
    name: 'One-shot WIEN2k → dmftproj → TRIQS',
    description: '全势磁性 DFT、dmftproj 投影、Wien2kConverter 与磁性 DMFT',
    stages: WIEN2K_DMFTPROJ_STAGES,
    steps: WIEN2K_DMFTPROJ_STEPS,
  },
  {
    id: 'triqs-model-dmft',
    name: '模型 DMFT（TRIQS）',
    description: '以研究方案承载科学细节，从模型构建、自洽求解到验证和成果封装的通用 DMFT 核心骨架',
    stages: TRIQS_MODEL_DMFT_STAGES,
    steps: TRIQS_MODEL_DMFT_STEPS,
  },
  {
    id: 'theoretical-research',
    name: '理论研究',
    description: '围绕原科学问题持续找路、建模、推导与验证，从失败中更新研究地图，目标达成后封装成果',
    stages: THEORETICAL_RESEARCH_STAGES,
    steps: THEORETICAL_RESEARCH_STEPS.map(withTheoryResearchLoop),
  },
  {
    id: 'physics-literature-reproduction',
    name: '物理文献复现',
    description: '面向解析理论、模型数值与真实材料论文，以逐主张、可比条件和证据链为核心的通用复现工作流',
    stages: PHYSICS_LITERATURE_REPRODUCTION_STAGES,
    steps: PHYSICS_LITERATURE_REPRODUCTION_STEPS,
  },
];

// === Helper Functions ===

export function getWorkflow(workflowId: string): WorkflowTemplate | undefined {
  return WORKFLOWS.find(w => w.id === workflowId);
}

export function getStages(workflowId: string): WorkflowStage[] {
  return getWorkflow(workflowId)?.stages ?? [];
}

export function getSteps(workflowId: string): WorkflowStep[] {
  return getWorkflow(workflowId)?.steps ?? [];
}

export function getStep(workflowId: string, stepId: string): WorkflowStep | undefined {
  return getSteps(workflowId).find(s => s.id === stepId);
}

export function getStageForStep(workflowId: string, stepId: string): WorkflowStage | undefined {
  const step = getStep(workflowId, stepId);
  if (!step) return undefined;
  return getStages(workflowId).find(s => s.id === step.stageId);
}

export function getStepsForStage(workflowId: string, stageId: string): WorkflowStep[] {
  return getSteps(workflowId).filter(s => s.stageId === stageId).sort((a, b) => a.order - b.order);
}

export function getTotalRequiredSteps(workflowId: string): number {
  return getSteps(workflowId).filter(s => !s.optional).length;
}
