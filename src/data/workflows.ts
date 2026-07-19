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

const DFT_DMFT_ONESHOT_RAW_STEPS: WorkflowStep[] = [
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

const STEP_DEPENDENCIES: Record<string, string[]> = {
  'prep-02': ['prep-01'],
  'prep-03': ['prep-01'],
  'prep-04': ['prep-01'],
  'prep-05': ['prep-04'],
  'prep-06': ['prep-01'],
  'dft-01': ['prep-03'],
  'dft-02': ['prep-03'],
  'dft-03': ['dft-02'],
  'dft-04': ['dft-02'],
  'wan-01': ['prep-04', 'dft-03'],
  'wan-02': ['dft-03', 'wan-01'],
  'wan-03': ['wan-02'],
  'wan-04': ['dft-04'],
  'wan-05': ['wan-03'],
  'dmft-01': ['prep-05', 'wan-05'],
  'dmft-02': ['dmft-01', 'wan-05'],
  'dmft-03': ['prep-06', 'dmft-02'],
  'chk-01': ['dmft-03'],
  'chk-02': ['dmft-03'],
};

const SCIENTIFIC_CHECKS: Record<string, string[]> = {
  'prep-01': ['研究目标、物理量、方法适用范围和所需精度已经明确记录'],
  'prep-02': ['测试体系的已知基准与软件版本记录完整，测试仅用于验证环境而非替代目标体系验证'],
  'prep-03': ['结构、元素、赝势来源与版本一致；所有数值参数均有研究者给出的依据'],
  'prep-04': ['投影轨道、能窗和能带数来自已审查的 DFT/PDOS 证据，而非自动猜测'],
  'prep-05': ['关联原子、壳层、轨道顺序和局域坐标与 Wannier 模型一致'],
  'prep-06': ['U/J、双计数、温度、求解器及统计参数均由研究者明确确认并记录来源'],
  'dft-01': ['结构优化达到项目定义的力/应力判据，最终结构没有非预期对称性或磁态变化'],
  'dft-02': ['电子自洽达到输入中定义的目标；k 网格、截断能和赝势收敛依据已经记录'],
  'dft-03': ['使用已确认的 SCF 电荷密度，k 点集合与后续 Wannier 接口要求一致'],
  'dft-04': ['费米能附近的轨道成分证据足以支持后续投影选择'],
  'wan-01': ['nnkp 与已确认的晶格、k 点集合、投影和能窗配置一致'],
  'wan-02': ['重叠矩阵和投影矩阵完整生成，未出现接口或 Bloch 态不一致错误'],
  'wan-03': ['Wannier 展宽与收敛行为已检查，未把程序退出码当作模型质量判据'],
  'wan-04': ['目标能区的轨道成分已经通过投影态密度证据核对'],
  'wan-05': ['在研究者指定的目标能窗和容差内核对 Wannier/TB 与 DFT 能带'],
  'dmft-01': ['Converter 壳层定义与已验证的 Wannier 哈密顿量和关联子空间一致'],
  'dmft-02': ['HDF5 中壳层、轨道维数、占据和 hopping 信息与输入模型一致'],
  'dmft-03': ['自能、占据、符号问题、Monte Carlo 统计和 DMFT 收敛按项目判据检查'],
  'chk-01': ['物理量的稳定性、误差和异常值已经结合求解器统计共同判断'],
  'chk-02': ['收敛序列不存在未解释的发散、持续振荡或数据缺失'],
};

const APPROVAL_POINTS: Record<string, string[]> = {
  'prep-01': ['研究者确认研究问题、方法边界和不可由智能体决定的科学参数'],
  'prep-02': ['研究者确认测试体系、配置文件和计算资源后再运行环境测试'],
  'prep-03': ['研究者确认结构、赝势、k/q 网格、截断能和收敛阈值'],
  'prep-04': ['研究者确认投影轨道、投影窗口、冻结窗口和能带数'],
  'prep-05': ['研究者确认关联壳层、轨道顺序和局域坐标映射'],
  'prep-06': ['研究者确认 U/J、双计数、温度、求解器和统计参数'],
  'dft-01': ['研究者确认结构自由度、磁性设置和结构优化判据'],
  'dft-02': ['研究者确认赝势、网格、截断能和电子收敛设置'],
  'dft-03': ['研究者确认 NSCF k 点集合与 Wannier 计划一致'],
  'wan-01': ['研究者确认投影、窗口和能带数后再生成接口数据'],
  'wan-03': ['研究者确认 disentanglement 和投影设置后再构建哈密顿量'],
  'dmft-01': ['研究者确认关联壳层定义与 Wannier 子空间一致'],
  'dmft-02': ['研究者确认 Converter 输入映射后再写入 HDF5'],
  'dmft-03': ['研究者确认 U/J、双计数、温度、求解器、资源和停止条件后再提交'],
};

const DEFAULT_FAILURE_HANDLING = [
  '停止所有依赖此步骤的后续动作并保留原始输入、输出和调度日志',
  '先诊断失败原因；如需修改命令或科学设置，创建新内容哈希并重新审批',
  '超时、输出不完整或远端状态未知时标记 unknown，禁止自动重试',
];

const DFT_DMFT_ONESHOT_STEPS: WorkflowStep[] = DFT_DMFT_ONESHOT_RAW_STEPS.map(step => {
  const dependencies = STEP_DEPENDENCIES[step.id] ?? [];
  const inputPrecondition = step.inputFiles?.length
    ? ['所需输入文件已存在，文件版本、来源和所属任务目录已经核对']
    : [];
  const dependencyPrecondition = dependencies.length
    ? ['所有前置步骤已经完成或由研究者明确标记为跳过']
    : [];
  const technicalCriteria = step.commands?.length
    ? ['命令退出码为 0，且输出中没有未处理的错误终止标记']
    : [];
  const outputCriteria = step.outputFiles?.length
    ? ['预期输出文件存在、非空，并且属于当前任务和当前步骤']
    : [];

  return {
    ...step,
    dependsOn: dependencies,
    preconditions: [...dependencyPrecondition, ...inputPrecondition],
    scientificChecks: SCIENTIFIC_CHECKS[step.id] ?? ['研究者已根据步骤目标检查结果，未以程序退出码代替科学判断'],
    successCriteria: [
      ...technicalCriteria,
      ...outputCriteria,
      '研究者确认所有科学检查项均有可追溯证据',
    ],
    failureHandling: DEFAULT_FAILURE_HANDLING,
    approvalPoints: APPROVAL_POINTS[step.id] ?? [],
  };
});

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
