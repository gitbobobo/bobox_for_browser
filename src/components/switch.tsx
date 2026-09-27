interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function Switch({ checked, disabled, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="bb-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="bb-switch-thumb" />
    </button>
  );
}
