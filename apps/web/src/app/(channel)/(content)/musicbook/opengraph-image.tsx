import { featureOgImage } from '@/features/channel/content/feature-og-image';
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from '@/meloming/shared/lib/opengraph-image-utils';

export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;
export const dynamic = 'force-dynamic';
export default function Image() { return featureOgImage('musicbook'); }
