import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getChannelIdentifierPermissionServer, getChannelIdentifierServer } from '@/meloming/domains/channel/apis/channels-server';
import { ChannelNewLayoutHeader } from '@/meloming/domains/channel/components/channel/channel-new-layout-header';
import UserNotFoundError from '@/meloming/domains/channel/components/channel/user-not-found-error';
import { PageErrorBoundary } from '@/meloming/shared/components/common/error-boundary';

export const CHANNEL_IDENTIFIER = 'hurogi';

type FeaturePageProps = {
  children: ReactNode;
  relatedLink?: { href: string; label: string };
  fillHeight?: boolean;
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

export async function FeaturePage({ children, relatedLink, fillHeight = false }: FeaturePageProps) {
  const [channel, permission] = await Promise.all([
    getChannelIdentifierServer(CHANNEL_IDENTIFIER),
    getChannelIdentifierPermissionServer(CHANNEL_IDENTIFIER),
  ]);
  if (!channel) notFound();
  if (permission && !permission.view) return <UserNotFoundError />;

  const content = (
    <>
      <ChannelNewLayoutHeader user={CHANNEL_IDENTIFIER} isWide={channel.layoutWidth === 'wide'} permissionData={permission} />
      {relatedLink && <div className="flex justify-end px-4 py-2"><Link href={relatedLink.href} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-soft">{relatedLink.label}</Link></div>}
      {children}
    </>
  );

  return (
    <PageErrorBoundary>
      {fillHeight ? <div className="flex h-full min-h-0 flex-col">{content}</div> : content}
    </PageErrorBoundary>
  );
}
