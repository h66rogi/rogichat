package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.schedule.Schedule
import chat.rogi.rogichat.channelport.core.model.schedule.ScheduleDTO
import chat.rogi.rogichat.channelport.core.model.schedule.SchedulesResponse
import chat.rogi.rogichat.channelport.core.network.dto.CreateScheduleRequest
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class ScheduleApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getChannelSchedules(
        channelId: Int,
        yearMonth: String,
    ): List<Schedule> {
        val response = apiClient.get<SchedulesResponse>("/v1/schedules/channel/$channelId") {
            url {
                parameters.append("ym", yearMonth)
            }
        }
        return response.items.map { it.toDomain() }
    }

    suspend fun getFavoriteSchedules(
        yearMonth: String,
    ): List<Schedule> {
        val response = apiClient.get<SchedulesResponse>("/v1/schedules/favorites") {
            url {
                parameters.append("ym", yearMonth)
            }
        }
        return response.items.map { it.toDomain() }
    }

    suspend fun createSchedule(
        channelId: Int,
        request: CreateScheduleRequest,
    ): Schedule {
        val response = apiClient.post<ScheduleDTO>("/v1/schedules/channel/$channelId") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }
        return response.toDomain()
    }

    suspend fun updateSchedule(scheduleId: Int, request: UpdateScheduleRequest): Schedule {
        val response = apiClient.patch<ScheduleDTO>("/v1/schedules/$scheduleId") {
            contentType(ContentType.Application.Json)
            setBody(ChannelWriteBodies.schedule(request))
        }
        return response.toDomain()
    }

    suspend fun deleteSchedule(scheduleId: Int) {
        apiClient.deleteWithoutResponse("/v1/schedules/$scheduleId")
    }
}
