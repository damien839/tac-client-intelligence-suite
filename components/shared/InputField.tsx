"use client";

interface InputFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  tooltip?: string;
}

export default function InputField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 0.01,
  min,
  max,
  tooltip,
}: InputFieldProps) {
  return (
    <div>
      <label className="label-text" title={tooltip}>
        {label}
        {tooltip && <span className="ml-1 text-tac-accent cursor-help" title={tooltip}>ⓘ</span>}
      </label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-tac-muted text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          min={min}
          max={max}
          className="input-field"
        />
        {suffix && <span className="text-tac-muted text-sm">{suffix}</span>}
      </div>
    </div>
  );
}
