import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Props = { rotulo: string; tom?: string; className?: string };

/** Badge de estado com tom vindo dos tokens (ver `lib/labels.ts`). */
export function StatusBadge({ rotulo, tom = 'bg-muted text-muted-foreground', className }: Props) {
  return (
    <Badge className={cn('border-transparent font-medium', tom, className)} variant="secondary">
      {rotulo}
    </Badge>
  );
}
