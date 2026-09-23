import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import {
  OVERLAY_WIDGET_TYPE_VALUES,
  type OverlayWidgetTypeValue,
} from '../constants/overlay-widget-type';

@Injectable()
export class ParseOverlayWidgetTypePipe
  implements PipeTransform<string, OverlayWidgetTypeValue>
{
  transform(
    value: string,
    _metadata: ArgumentMetadata,
  ): OverlayWidgetTypeValue {
    if (!OVERLAY_WIDGET_TYPE_VALUES.includes(value as OverlayWidgetTypeValue)) {
      throw new BadRequestException([
        `widget must be one of: ${OVERLAY_WIDGET_TYPE_VALUES.join(', ')}`,
      ]);
    }
    return value as OverlayWidgetTypeValue;
  }
}
