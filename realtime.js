// ═══════════════════════════════════════════════════════════════
// REALTIME - Подписки на изменения в реальном времени
// ═══════════════════════════════════════════════════════════════

class RealtimeManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.subscriptions = new Map();
  }

  // Подписка на изменения бронирований
  subscribeToBookings(callback) {
    const channel = this.supabase
      .channel('bookings-changes')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'bookings' 
        },
        (payload) => {
          console.log('Booking change:', payload);
          callback(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('bookings', channel);
    return channel;
  }

  // Подписка на изменения мест
  subscribeToSeats(callback) {
    const channel = this.supabase
      .channel('seats-changes')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'seats' 
        },
        (payload) => {
          console.log('Seat change:', payload);
          callback(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('seats', channel);
    return channel;
  }

  // Подписка на изменения зон
  subscribeToZones(callback) {
    const channel = this.supabase
      .channel('zones-changes')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'zones' 
        },
        (payload) => {
          console.log('Zone change:', payload);
          callback(payload);
        }
      )
      .subscribe();

    this.subscriptions.set('zones', channel);
    return channel;
  }

  // Отписка от всех каналов
  unsubscribeAll() {
    this.subscriptions.forEach((channel) => {
      this.supabase.removeChannel(channel);
    });
    this.subscriptions.clear();
  }

  // Отписка от конкретного канала
  unsubscribe(name) {
    const channel = this.subscriptions.get(name);
    if (channel) {
      this.supabase.removeChannel(channel);
      this.subscriptions.delete(name);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// BOOKING MANAGER - Управление бронированиями с проверкой конфликтов
// ═══════════════════════════════════════════════════════════════

class BookingManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  // Создание бронирования с проверкой конфликтов
  async createBooking(bookingData) {
    // Проверяем конфликты
    const hasConflict = await this.checkConflict(
      bookingData.seat_id,
      bookingData.booking_date,
      bookingData.time_slot,
      bookingData.start_time,
      bookingData.end_time
    );

    if (hasConflict) {
      throw new Error('Это место уже забронировано на выбранное время');
    }

    // Создаем бронирование
    const { data, error } = await this.supabase
      .from('bookings')
      .insert([bookingData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Проверка конфликтов через функцию БД
  async checkConflict(seatId, bookingDate, timeSlot, startTime = null, endTime = null) {
    const { data, error } = await this.supabase
      .rpc('check_booking_conflict', {
        p_seat_id: seatId,
        p_booking_date: bookingDate,
        p_time_slot: timeSlot,
        p_start_time: startTime,
        p_end_time: endTime
      });

    if (error) throw error;
    return data;
  }

  // Получение активных бронирований на дату
  async getActiveBookings(date) {
    const { data, error } = await this.supabase
      .from('bookings')
      .select(`
        *,
        seat:seats(*),
        user:users(full_name, email)
      `)
      .eq('booking_date', date)
      .eq('status', 'active');

    if (error) throw error;
    return data;
  }

  // Отмена бронирования
  async cancelBooking(bookingId) {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

// Экспорт для использования
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RealtimeManager, BookingManager };
}
