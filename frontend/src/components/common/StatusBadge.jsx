import { Badge } from '@/components/ui/badge';
import { getStatusVariant } from '@/constants/statusStyles';

const formatLabel = (value) => value.replace(/_/g, ' ');

/** Renders a Badge colored by the centralized status→variant map (statusStyles.js). */
export function StatusBadge({ type, value, className }) {
  if (!value) return null;
  return (
    <Badge variant={getStatusVariant(type, value)} className={className}>
      {formatLabel(value)}
    </Badge>
  );
}
