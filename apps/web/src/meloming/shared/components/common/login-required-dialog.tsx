"use client";

import { useCallback, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { useRouter } from "next/navigation";

interface LoginRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional override for redirect path. Defaults to current location */
  fromPath?: string;
  /** Optional notice rendered between the description and the footer (e.g. login-free alternative). */
  notice?: ReactNode;
}

/**
 * A reusable dialog prompting the user to log in before using restricted features.
 */
export default function LoginRequiredDialog({
  open,
  onOpenChange,
  fromPath,
  notice,
}: LoginRequiredDialogProps) {
  const router = useRouter();

  const handleMove = useCallback(() => {
    const current =
      fromPath ?? `${window.location.pathname}${window.location.search}`;
    const encoded = encodeURIComponent(current);
    router.push(`/auth/login?from=${encoded}`);
  }, [fromPath, router]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>로그인이 필요해요</AlertDialogTitle>
          <AlertDialogDescription>
            해당 기능을 이용하려면 로그인이 필요해요. 로그인 페이지로
            이동하시겠습니까?
          </AlertDialogDescription>
        </AlertDialogHeader>
        {notice}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleMove}>이동</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
