import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel } from "@/meloming/domains/channel/types/channel";

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

export const OG_IMAGE_CONTENT_TYPE = "image/png";

/**
 * 채널 OpenGraph 이미지를 생성합니다.
 */
export async function generateChannelOGImage(
  channel: Channel | null,
  favoritesCount: number,
  pathSuffix?: string
): Promise<ImageResponse> {
  const paperlogyRegular = await readFile(
    join(process.cwd(), "public/fonts/Paperlogy-4Regular.ttf")
  );

  const paperlogyBold = await readFile(
    join(process.cwd(), "public/fonts/Paperlogy-7Bold.ttf")
  );

  const logoUrl = new URL(
    "/icons/rogichat-icon.svg",
    process.env.NEXT_PUBLIC_BASE_URL || "https://rogi.chat"
  ).toString();

  // 채널이 없을 때 기본 이미지
  if (!channel) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "white",
            flexDirection: "column",
          }}
        >
          <img
            src={logoUrl}
            alt="로기챗"
            style={{
              width: "180px",
              height: "180px",
              borderRadius: "24px",
              marginBottom: "32px",
              display: "flex",
            }}
          />
          <div
            style={{
              color: "#6366f1",
              fontSize: "64px",
              fontWeight: "bold",
              fontFamily: "Paperlogy",
              display: "flex",
            }}
          >
            로기챗
          </div>
        </div>
      ),
      {
        ...OG_IMAGE_SIZE,
        fonts: [
          {
            name: "Paperlogy",
            data: paperlogyBold,
            weight: 700,
            style: "normal",
          },
        ],
      }
    );
  }

  const themeColor = channel.themeColor || "#667eea";
  const urlPath = pathSuffix
    ? `rogi.chat/channel/${channel.webPath}/${pathSuffix}`
    : `rogi.chat/channel/${channel.webPath}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: `linear-gradient(to bottom, white 0%, white 80%, ${themeColor} 80%, ${themeColor} 100%)`,
          fontFamily: "Paperlogy",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            padding: "60px 80px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "60px",
            }}
          >
            <img
              src={logoUrl}
              alt="로기챗"
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "16px",
                marginRight: "20px",
                display: "flex",
              }}
            />
            <div
              style={{
                color: "#6366f1",
                fontSize: "48px",
                fontWeight: "700",
                display: "flex",
              }}
            >
              로기챗
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                color: "#111827",
                fontSize: "80px",
                fontWeight: "bold",
                marginBottom: "48px",
                display: "flex",
                maxWidth: "780px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {channel.name}
            </div>

            <div
              style={{
                display: "flex",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#f3f4f6",
                  padding: "16px 32px",
                  borderRadius: "12px",
                  marginRight: "20px",
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    marginRight: "12px",
                    display: "flex",
                  }}
                >
                  <path
                    d="M9 18V5l12-2v13M9 18c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3zm12-2c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3z"
                    stroke="#111827"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div
                  style={{
                    color: "#111827",
                    fontSize: "28px",
                    fontWeight: "600",
                    display: "flex",
                  }}
                >
                  {channel._count.songs}곡
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#f3f4f6",
                  padding: "16px 32px",
                  borderRadius: "12px",
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    marginRight: "12px",
                    display: "flex",
                  }}
                >
                  <path
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    fill="#111827"
                    stroke="#111827"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div
                  style={{
                    color: "#111827",
                    fontSize: "28px",
                    fontWeight: "600",
                    display: "flex",
                  }}
                >
                  {favoritesCount}명
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
              }}
            >
              <div
                style={{
                  color: "#9ca3af",
                  fontSize: "26px",
                  fontWeight: "500",
                  display: "flex",
                }}
              >
                {urlPath}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: "60px",
            right: "80px",
            display: channel.profileImageUrl ? "flex" : "none",
          }}
        >
          <img
            src={channel.profileImageUrl || ""}
            alt={channel.name}
            style={{
              width: "240px",
              height: "240px",
              borderRadius: "24px",
              objectFit: "cover",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      fonts: [
        {
          name: "Paperlogy",
          data: paperlogyRegular,
          weight: 400,
          style: "normal",
        },
        {
          name: "Paperlogy",
          data: paperlogyBold,
          weight: 700,
          style: "normal",
        },
      ],
    }
  );
}

