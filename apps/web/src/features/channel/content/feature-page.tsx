import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getChannelIdentifierPermissionServer, getChannelIdentifierServer } from '@/meloming/domains/channel/apis/channels-server';
import UserNotFoundError from '@/meloming/domains/channel/components/channel/user-not-found-error';
import { PageErrorBoundary } from '@/meloming/shared/components/common/error-boundary';

export const CHANNEL_IDENTIFIER = 'hurogi';

type FeaturePageProps = {
  title: string;
  description: string;
  children: ReactNode;
  manageSection?: string;
  relatedLink?: { href: string; label: string };
};

export async function featureMetadata(title: string, description: string): Promise<Metadata> {
  const channel = await getChannelIdentifierServer(CHANNEL_IDENTIFIER);
  if (!channel) notFound();
  const fullTitle = `${channel.name} ${title}`;
  return {
    title: fullTitle,
    description: `${channel.name}의 ${description}`,
    openGraph: { title: `${fullTitle} - 로기챗`, description: `${channel.name}의 ${description}`, siteName: '로기챗', type: 'website' },
    twitter: { card: 'summary_large_image', title: `${fullTitle} - 로기챗`, description: `${channel.name}의 ${description}` },
  };
}

export async function FeaturePage({ title, description, children, manageSection, relatedLink }: FeaturePageProps) {
  const [channel, permission] = await Promise.all([
    getChannelIdentifierServer(CHANNEL_IDENTIFIER),
    getChannelIdentifierPermissionServer(CHANNEL_IDENTIFIER),
  ]);
  if (!channel) notFound();
  if (permission && !permission.view) return <UserNotFoundError />;
  const canManage = Boolean(permission?.isOwner || permission?.manageContent);

  return (
    <PageErrorBoundary>
      <div className="border-b border-line-subtle px-4 py-5 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{title}</h1>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {relatedLink && <Link href={relatedLink.href} className="rounded-full border border-line px-4 py-2 font-medium text-ink hover:bg-surface-soft">{relatedLink.label}</Link>}
            {canManage && manageSection && <Link href={`/channel/${CHANNEL_IDENTIFIER}/manage/${manageSection}`} className="rounded-full border border-line px-4 py-2 font-medium text-ink hover:bg-surface-soft">관리</Link>}
          </div>
        </div>
      </div>
      {children}
    </PageErrorBoundary>
  );
}
