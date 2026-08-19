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
    description: '判断计算是否成功，分析物理结果',
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
    name: '检查 observables_imp0.dat',
    description: '查看杂质物理量的演化，判断 DMFT 计算是否收敛以及体系的金属/绝缘特性。',
    commands: ['cat observables_imp0.dat'],
    inputFiles: ['observables_imp0.dat'],
    tips: '关注自能、双占据数、准粒子权重是否稳定。判断体系是金属态还是绝缘态。',
  },
  {
    id: 'chk-02',
    stageId: 'check',
    order: 2,
    name: '检查 conv_imp0.dat',
    description: '查看自洽误差的收敛行为，确认误差是否真正下降或进入稳定平台。',
    commands: ['cat conv_imp0.dat'],
    inputFiles: ['conv_imp0.dat', 'conv_obs0.dat'],
    tips: '自洽误差应单调下降或在某个小值附近波动。如果发散或振荡过大，需要检查参数。',
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
  { id: 'check', name: '结果检查', description: '检查收敛、磁性状态和主要物理结果' },
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
    id: 'qenm-check-01', stageId: 'check', order: 1, name: '检查 DMFT 收敛',
    description: '检查迭代误差、占据、自能和主要杂质观测量，确认计算稳定且物理量合理。',
    inputFiles: ['observables_imp*.dat', 'conv_imp*.dat'],
  },
  {
    id: 'qenm-check-02', stageId: 'check', order: 2, name: '检查自发磁性结果',
    description: '比较基线与磁性计算的磁矩和自旋分辨物理量，判断是否形成研究方案预期的磁性状态。',
  },
  {
    id: 'qenm-check-03', stageId: 'check', order: 3, name: '整理电子结构结果',
    description: '按研究目标整理占据、自能、谱函数和其他必要结果，记录本次计算使用的输入与配置。',
    outputFiles: ['results_summary.md'],
  },
];

// === WIEN2k + dmftproj + TRIQS ===
const WIEN2K_DMFTPROJ_STAGES = makeWorkflowStages([
  { id: 'prep', name: '准备阶段', description: '确定计算目标、检查软件环境、准备输入文件' },
  { id: 'wien', name: 'WIEN2k DFT 计算', description: '初始化、结构优化、自旋计算、能带和态密度' },
  { id: 'projector', name: 'dmftproj 投影', description: '准备投影输入、生成局域轨道并检查投影结果' },
  { id: 'dmft', name: 'TRIQS DMFT 计算', description: 'DFTTools 转换、DMFT 配置和 one-shot 计算' },
  { id: 'check', name: '结果检查', description: '检查收敛、磁性状态和主要物理结果' },
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
    id: 'wien-check-01', stageId: 'check', order: 1, name: '检查 DMFT 收敛',
    description: '检查迭代误差、占据、自能和主要杂质观测量，确认计算稳定且物理量合理。',
    inputFiles: ['observables_imp*.dat', 'conv_imp*.dat'],
  },
  {
    id: 'wien-check-02', stageId: 'check', order: 2, name: '检查磁性与电子状态',
    description: '检查局域磁矩、自旋分辨占据、自能和金属或绝缘特征，判断是否得到研究方案预期的物理状态。',
  },
  {
    id: 'wien-check-03', stageId: 'check', order: 3, name: '整理电子结构结果',
    description: '按研究目标整理占据、自能、谱函数和其他必要结果，记录本次计算使用的输入与配置。',
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

function theoreticalStageReflectionStep(stageId: string, order: number): WorkflowStep {
  return {
    id: `theory-${stageId}-reflection`, stageId, order, name: '记录、反思与下一步判断',
    description: '反思前主动从反例、竞争机制、可控极限和可检验预测等方向寻找可能改变、扩展或推翻中心结论的新想法；不设数量指标，不为凑数制造想法，未发现时简要记录已审视的方向。记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出处置。高价值想法只有在引用证据并标记为已解决或已证伪后才闭合；暂缓或转后续任务仍保持未决。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。',
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
    description: '整理严格结果、主流解释、已有解析或数值基准，以及当前理论必须满足的实验事实。',
    outputFiles: ['literature_constraints.md'],
  },
  {
    id: 'theory-context-02', stageId: 'context', order: 2, name: '识别理论缺口与研究新增量',
    description: '比较已有路线的覆盖范围与矛盾，明确尚未解决的问题，以及本研究准备增加的理论内容。',
    outputFiles: ['novelty_statement.md'],
  },
  theoreticalStageReflectionStep('context', 3),
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
    description: '完成主要公式和逻辑链，保留关键中间结果，并记录对最终结论有影响的推导分支。',
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
    description: '尽可能采用不同表示、替代推导、符号检查或小规模数值验证关键结论；无法交叉验证的部分必须明确记录。',
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
    id: 'theoretical-research',
    name: '理论研究',
    description: '从问题定义、模型与推导到一致性验证、物理预测和成果封装',
    stages: THEORETICAL_RESEARCH_STAGES,
    steps: THEORETICAL_RESEARCH_STEPS,
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
