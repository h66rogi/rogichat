"use client";

interface ManagementHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  children?: React.ReactNode;
}

// toss-fe 가이드라인: Abstracting Implementation Details - 공통 헤더를 별도 컴포넌트로 분리
export function ManagementHeader({
  title,
  description,
  icon: Icon,
  children,
}: ManagementHeaderProps) {

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {Icon && (
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                <Icon size={20} className="text-primary" />
              </div>
            )}
            <h2 className="text-2xl font-bold paperlogy">{title}</h2>
          </div>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-2 sm:justify-end">
            {children}
          </div>
        )}
      </div>
    </>
  );
}
