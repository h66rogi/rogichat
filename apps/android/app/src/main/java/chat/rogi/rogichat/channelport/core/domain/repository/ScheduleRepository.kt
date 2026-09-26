package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.schedule.Schedule
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest

interface ScheduleRepository {
    suspend fun getChannelSchedules(channelId: Int, yearMonth: String): Result<List<Schedule>>

    suspend fun getFavoriteSchedules(yearMonth: String): Result<List<Schedule>>

    suspend fun createSchedule(
        channelId: Int,
        title: String,
        startAt: String,
        endAt: String? = null,
        allDay: Boolean = false,
        status: String = "TBD",
        visibility: String = "PUBLIC",
        location: String? = null,
        externalUrl: String? = null,
        content: String? = null,
    ): Result<Schedule>

    suspend fun updateSchedule(scheduleId: Int, request: UpdateScheduleRequest): Result<Schedule>

    suspend fun deleteSchedule(scheduleId: Int): Result<Unit>
}
