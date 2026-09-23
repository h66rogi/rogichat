import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ user: string }>;
};

export default async function ChannelManageAddSongExcelPage({ params }: Props) {
  const { user } = await params;
  redirect(`/channel/${user}/manage/add-song?tab=excel`);
}
