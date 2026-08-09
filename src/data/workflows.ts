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

// === Workflow Registry ===
export const WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'dft-dmft-oneshot',
    name: 'One-shot DFT+DMFT',
    description: '单次 DMFT 计算，不自洽更新电荷密度',
    stages: DFT_DMFT_ONESHOT_STAGES,
    steps: DFT_DMFT_ONESHOT_STEPS,
  },
  // Future: 'dft-dmft-charge-selfconsistent', 'dft-only', etc.
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
