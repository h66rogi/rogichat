package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.ScheduleRepository
import chat.rogi.rogichat.channelport.core.model.schedule.Schedule
import chat.rogi.rogichat.channelport.core.network.api.ScheduleApi
import chat.rogi.rogichat.channelport.core.network.dto.CreateScheduleRequest
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import timber.log.Timber

class ScheduleRepositoryImpl constructor(
    private val scheduleApi: ScheduleApi,
) : ScheduleRepository {

    override suspend fun getChannelSchedules(
        channelId: Int,
        yearMonth: String,
    ): Result<List<Schedule>> = runCatching {
        scheduleApi.getChannelSchedules(channelId, yearMonth)
    }.onFailure { Timber.e(it, "Failed to get channel schedules") }

    override suspend fun getFavoriteSchedules(yearMonth: String): Result<List<Schedule>> = runCatching {
        scheduleApi.getFavoriteSchedules(yearMonth)
    }.onFailure { Timber.e(it, "Failed to get favorite schedules") }

    override suspend fun createSchedule(
        channelId: Int,
        title: String,
        startAt: String,
        endAt: String?,
        allDay: Boolean,
        status: String,
        visibility: String,
        location: String?,
        externalUrl: String?,
        content: String?,
    ): Result<Schedule> = runCatching {
        val request = CreateScheduleRequest(
            title = title,
            startAt = startAt,
            endAt = endAt,
            allDay = allDay,
            status = status,
            visibility = visibility,
            location = location,
            externalUrl = externalUrl,
            content = content,
        )
        scheduleApi.createSchedule(channelId, request)
    }.onFailure { Timber.e(it, "Failed to create schedule") }

    override suspend fun updateSchedule(scheduleId: Int, request: UpdateScheduleRequest): Result<Schedule> = runCatching {
        scheduleApi.updateSchedule(scheduleId, request)
    }.onFailure { Timber.e(it, "Failed to update schedule") }

    override suspend fun deleteSchedule(scheduleId: Int): Result<Unit> = runCatching {
        scheduleApi.deleteSchedule(scheduleId)
    }.onFailure { Timber.e(it, "Failed to delete schedule") }
}
