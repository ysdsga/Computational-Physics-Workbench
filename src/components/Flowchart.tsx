import { useState } from 'react';
import { getStagesOf, getStepsForStageOf } from '../contexts/WorkflowContext';
import type { WorkflowTemplate, WorkflowStep, StepStatus, StepProgress } from '../types';

const STEP_WIDTH = 170;
const STEP_HEIGHT = 72;
const STAGE_LABEL_WIDTH = 130;
const H_GAP = 24;
const V_GAP = 12;
const STAGE_HEADER_H = 36;
const PADDING_X = 20;
const PADDING_Y = 16;

const statusColors: Record<StepStatus, { fill: string; stroke: string; text: string }> = {
  pending:    { fill: '#252536', stroke: '#383850', text: '#6b6b80' },
  in_progress:{ fill: '#1e293b', stroke: '#3b82f6', text: '#60a5fa' },
  completed:  { fill: '#1a2e1a', stroke: '#22c55e', text: '#4ade80' },
  skipped:    { fill: '#252536', stroke: '#4a4a60', text: '#4a4a60' },
};

interface Props {
  workflow: WorkflowTemplate;
  progressMap: Record<string, StepProgress>;
  observationMap?: Record<string, { actions: number; jobs: number; evidence: number }>;
  onSelectStep: (step: WorkflowStep) => void;
  selectedStepId: string | null;
}

export default function Flowchart({ workflow, progressMap, observationMap = {}, onSelectStep, selectedStepId }: Props) {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  const stages = getStagesOf(workflow);
  const stageLayouts = stages.map(stage => ({
    stage,
    steps: getStepsForStageOf(workflow, stage.id),
  }));

  const maxSteps = Math.max(...stageLayouts.map(s => s.steps.length));
  const svgWidth = PADDING_X * 2 + STAGE_LABEL_WIDTH + maxSteps * (STEP_WIDTH + H_GAP) + 20;
  const svgHeight = PADDING_Y * 2 +
    stageLayouts.length * (STAGE_HEADER_H + V_GAP + STEP_HEIGHT + V_GAP * 2);

  return (
    <div className="overflow-auto flex-1">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="block"
        style={{ minWidth: '100%' }}
      >
        <rect width={svgWidth} height={svgHeight} fill="#131320" />

        {stageLayouts.map(({ stage, steps }, stageIdx) => {
          const stageY = PADDING_Y +
            stageIdx * (STAGE_HEADER_H + V_GAP + STEP_HEIGHT + V_GAP * 2);

          return (
            <g key={stage.id}>
              <rect
                x={PADDING_X}
                y={stageY}
                width={svgWidth - PADDING_X * 2}
                height={STAGE_HEADER_H + V_GAP + STEP_HEIGHT + V_GAP}
                rx={8}
                fill={stage.colorBg}
                stroke={stage.colorBorder}
                strokeWidth={1}
                opacity={0.6}
              />
              <rect
                x={PADDING_X + 8}
                y={stageY + 8}
                width={STAGE_LABEL_WIDTH - 16}
                height={STAGE_HEADER_H - 16}
                rx={4}
                fill={stage.color}
                opacity={0.85}
              />
              <text
                x={PADDING_X + STAGE_LABEL_WIDTH / 2}
                y={stageY + STAGE_HEADER_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={12}
                fontWeight={600}
              >
                {stage.name}
              </text>
              <text
                x={PADDING_X + STAGE_LABEL_WIDTH + 12}
                y={stageY + STAGE_HEADER_H / 2}
                dominantBaseline="central"
                fill="#6b6b80"
                fontSize={11}
              >
                {stage.description}
              </text>

              {steps.map((step, stepIdx) => {
                const stepX = PADDING_X + STAGE_LABEL_WIDTH + stepIdx * (STEP_WIDTH + H_GAP) + (stepIdx === 0 ? 20 : 0);
                const stepY = stageY + STAGE_HEADER_H + V_GAP;
                const isSelected = selectedStepId === step.id;
                const isHovered = hoveredStep === step.id;
                const progress = progressMap[step.id];

                return (
                  <StepNode
                    key={step.id}
                    step={step}
                    x={stepX}
                    y={stepY}
                    status={progress?.status ?? 'pending'}
                    observation={observationMap[step.id]}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    onSelect={() => onSelectStep(step)}
                    onHover={(h) => setHoveredStep(h ? step.id : null)}
                  />
                );
              })}

              {steps.map((step, stepIdx) => {
                if (stepIdx === steps.length - 1) return null;
                const fromX = PADDING_X + STAGE_LABEL_WIDTH + stepIdx * (STEP_WIDTH + H_GAP) + (stepIdx === 0 ? 20 : 0) + STEP_WIDTH;
                const toX = fromX + H_GAP;
                const cy = stageY + STAGE_HEADER_H + V_GAP + STEP_HEIGHT / 2;
                return <Arrow key={`arrow-${step.id}`} x1={fromX} y1={cy} x2={toX} y2={cy} />;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StepNode({
  step, x, y, status, observation, isSelected, isHovered, onSelect, onHover,
}: {
  step: WorkflowStep;
  x: number; y: number;
  status: StepStatus;
  observation?: { actions: number; jobs: number; evidence: number };
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
}) {
  const colors = statusColors[status];
  const strokeW = isSelected ? 2.5 : isHovered ? 2 : 1.5;
  const strokeColor = isSelected ? '#60a5fa' : colors.stroke;
  const fillColor = isHovered ? '#2d2d44' : colors.fill;
  const opacity = status === 'skipped' ? 0.5 : 1;

  return (
    <g
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ cursor: 'pointer' }}
      opacity={opacity}
    >
      <rect x={x} y={y} width={STEP_WIDTH} height={STEP_HEIGHT} rx={8}
        fill={fillColor} stroke={strokeColor} strokeWidth={strokeW} className="transition-all" />
      <circle cx={x + 14} cy={y + 18} r={5} fill={isHovered ? strokeColor : colors.stroke} />
      <text x={x + 26} y={y + 20} fill={isHovered ? '#e2e2f0' : colors.text}
        fontSize={11.5} fontWeight={isSelected ? 600 : 500} style={{ userSelect: 'none' }}>
        {step.name.length > 10 ? step.name.slice(0, 10) + '…' : step.name}
      </text>
      {step.optional && (
        <>
          <rect x={x + STEP_WIDTH - 36} y={y + 6} width={26} height={14} rx={3} fill="#2d2d44" />
          <text x={x + STEP_WIDTH - 23} y={y + 14} fill="#6b6b80" fontSize={8}
            textAnchor="middle" dominantBaseline="central">可选</text>
        </>
      )}
      <text x={x + 14} y={y + 42} fill="#6b6b80" fontSize={10} style={{ userSelect: 'none' }}>
        {status === 'completed' ? '✓ 已完成' : status === 'in_progress' ? '● 进行中' : status === 'skipped' ? '— 已跳过' : '○ 待开始'}
      </text>
      {(step.inputFiles && step.inputFiles.length > 0) && (
        <text x={x + STEP_WIDTH - 14} y={y + 42} fill="#4a4a60" fontSize={9} textAnchor="end" style={{ userSelect: 'none' }}>
          {step.inputFiles.length} 文件
        </text>
      )}
      {observation && (observation.actions > 0 || observation.jobs > 0 || observation.evidence > 0) && (
        <text x={x + 14} y={y + 61} fill="#8bcaba" fontSize={8.5} style={{ userSelect: 'none' }}>
          CODEX  M{observation.actions} · J{observation.jobs} · E{observation.evidence}
        </text>
      )}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <g>
      <line x1={x1 + 2} y1={y1} x2={x2 - 2} y2={y2} stroke="#383850" strokeWidth={1.5} />
      <polygon points={`${x2 - 2},${y2 - 4} ${x2 + 6},${y2} ${x2 - 2},${y2 + 4}`} fill="#383850" />
    </g>
  );
}
