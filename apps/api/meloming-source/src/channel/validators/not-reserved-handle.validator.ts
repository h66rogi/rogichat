import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isReservedHandle } from '../constants/reserved-handles';

@ValidatorConstraint({ name: 'notReservedHandle', async: false })
export class NotReservedHandleConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return true; // 다른 validator 가 string 검증 담당
    return !isReservedHandle(value);
  }

  defaultMessage(): string {
    return '이 채널 주소는 예약어로 등록되어 있어 사용할 수 없습니다.';
  }
}

/**
 * `webPath` 같은 채널 핸들 필드에 붙여 예약어 사용을 차단하는 decorator.
 * 다른 핸들 정규식(@Matches)·길이(@MinLength)와 같은 위치에 적용한다.
 */
export function IsNotReservedHandle(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: NotReservedHandleConstraint,
    });
  };
}
