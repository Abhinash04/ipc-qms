import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Query Management System</p>
        <h1 className="mt-1 text-lg font-semibold text-foreground">Sign in</h1>
      </CardHeader>
      <CardBody className="space-y-4 text-sm text-muted-foreground">
        <p>
          Authentication is not implemented yet. The app is currently running with a mock
          session as <span className="font-medium text-foreground">{currentUser?.name}</span>.
        </p>
        <Link to={ROUTE_PATHS.DASHBOARD}>
          <Button className="w-full">Continue to dashboard</Button>
        </Link>
      </CardBody>
    </Card>
  );
}
