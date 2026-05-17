import { ArrowLeft } from 'lucide-react';
import './SectionHeader.css';

interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  onBack: () => void;
}

export default function SectionHeader({ title, icon, onBack }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <button className="section-header-back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={18} />
      </button>
      <h2 className="section-header-title">
        {icon && <span className="section-header-icon">{icon}</span>}
        {title}
      </h2>
    </div>
  );
}
